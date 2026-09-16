import { describe, expect, it } from 'vitest';
import {
  evaluateAlerts,
  forecastEnsemble,
  forecastFromState,
  forecastScenarioEnsemble,
  resolveOperationsSchedule,
  summarizeOutlook,
  OPERATIONS_SCENARIOS,
  type ForecastResult,
} from '../src/operations/index.js';
import type { TwinCycle } from '../src/assimilation/types.js';
import type { ChannelDiagnostics } from '../src/telemetry/types.js';
import { DEFAULT_PARAMETERS, mostLikelyInputs, toResourceInputs } from '../src/index.js';
import {
  DEFAULT_DYNAMIC_PARAMETERS,
  initialDynamicState,
  sampleEnsembleColumns,
  toDynamicParams,
  TOTAL_STEPS,
  constantSchedule,
  controlsAt,
} from '../src/dynamics/index.js';
import type { DynamicParams, ReservoirState } from '../src/dynamics/types.js';

const BASE_INPUTS = mostLikelyInputs();
const BASE_PARAMS = toDynamicParams(BASE_INPUTS, {
  totalCompressibilityPerBar: DEFAULT_DYNAMIC_PARAMETERS.cTotal.mostLikely,
  rechargeKgS: DEFAULT_DYNAMIC_PARAMETERS.recharge.mostLikely,
});
const BASE_SCHEDULE = constantSchedule(80, 56, 60);

function baseState(): { state: ReservoirState; params: DynamicParams } {
  const { state, params } = initialDynamicState(BASE_INPUTS, {
    totalCompressibilityPerBar: DEFAULT_DYNAMIC_PARAMETERS.cTotal.mostLikely,
    rechargeKgS: DEFAULT_DYNAMIC_PARAMETERS.recharge.mostLikely,
  });
  return { state, params };
}

describe('forecastFromState', () => {
  it('branches deterministically without mutating the branch point', () => {
    const { state, params } = baseState();
    const before = JSON.stringify(state);
    const a = forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: 0, nSteps: 24 });
    const b = forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: 0, nSteps: 24 });
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(before);
    expect(a.states.length).toBe(25);
    expect(a.truncated).toBe(false);
    expect(a.states[0]).toEqual(state);
    expect(a.states[24]!.timeYears).toBeCloseTo(2, 9);
  });

  it('declines under extraction and truncates loudly on depletion', () => {
    const { state, params } = baseState();
    const mild = forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: 0, nSteps: 12 });
    expect(mild.states[12]!.pressureBar).toBeLessThan(state.pressureBar);
    const violent = forecastFromState({
      fromState: state,
      params,
      schedule: constantSchedule(5000, 0, 60),
      startStep: 0,
      nSteps: 120,
    });
    expect(violent.truncated).toBe(true);
    expect(typeof violent.stopReason).toBe('string');
    expect(violent.states.length).toBeLessThan(121);
  });

  it('rejects invalid horizons loudly', () => {
    const { state, params } = baseState();
    expect(() => forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: -1, nSteps: 12 })).toThrow(RangeError);
    expect(() => forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: TOTAL_STEPS, nSteps: 12 })).toThrow(RangeError);
    expect(() => forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: 0, nSteps: 0 })).toThrow(RangeError);
  });
});

describe('forecastEnsemble', () => {
  it('runs members independently and counts depletion', () => {
    const { state, params } = baseState();
    const { members, rejected } = forecastEnsemble({
      members: [
        { index: 0, state: { ...state }, params },
        { index: 1, state: { ...state }, params },
      ],
      schedule: BASE_SCHEDULE,
      startStep: 0,
      nSteps: 12,
    });
    expect(members.length).toBe(2);
    expect(rejected).toBe(0);
    expect(members[0]!.states).toEqual(members[1]!.states);
  });
});

describe('resolveOperationsSchedule', () => {
  it('holds baseline before the branch and scales after', () => {
    const scenario = OPERATIONS_SCENARIOS.find((s) => s.id === 'high-production')!;
    const resolved = resolveOperationsSchedule(BASE_SCHEDULE, scenario, 120);
    expect(controlsAt(resolved, 0).productionKgS).toBe(80);
    expect(controlsAt(resolved, 119).productionKgS).toBe(80);
    expect(controlsAt(resolved, 120).productionKgS).toBeCloseTo(100, 9);
    expect(controlsAt(resolved, 200).injectionKgS).toBe(56);
  });

  it('accepts absolute custom rates and rejects bad scales', () => {
    const resolved = resolveOperationsSchedule(BASE_SCHEDULE, { productionKgS: 40, injectionKgS: 70 }, 60);
    expect(controlsAt(resolved, 60).productionKgS).toBe(40);
    expect(controlsAt(resolved, 60).injectionKgS).toBe(70);
    expect(() => resolveOperationsSchedule(BASE_SCHEDULE, { productionKgS: -5, injectionKgS: 70 }, 60)).toThrow(RangeError);
    expect(() =>
      resolveOperationsSchedule(BASE_SCHEDULE, { id: 'x', label: 'x', notes: '', productionScale: 9, injectionScale: 1 }, 60),
    ).toThrow(RangeError);
    expect(() => resolveOperationsSchedule(BASE_SCHEDULE, OPERATIONS_SCENARIOS[0]!, TOTAL_STEPS + 1)).toThrow(RangeError);
  });
});

describe('forecastScenarioEnsemble', () => {
  function columns(n: number) {
    return sampleEnsembleColumns(n, 7, DEFAULT_PARAMETERS, DEFAULT_DYNAMIC_PARAMETERS);
  }

  it('builds ordered bands around a deterministic branch, reproducibly', () => {
    const { state } = baseState();
    const { staticColumns, dynamicColumns } = columns(20);
    const input = {
      scenarioId: 'baseline',
      estimatedState: state,
      parameters: DEFAULT_PARAMETERS,
      dynamicParameters: DEFAULT_DYNAMIC_PARAMETERS,
      staticColumns,
      dynamicColumns,
      lifetimeYears: 30,
      schedule: BASE_SCHEDULE,
      startStep: 0,
      nSteps: 24,
    };
    const a = forecastScenarioEnsemble(input);
    const b = forecastScenarioEnsemble(input);
    expect(a).toEqual(b);
    expect(a.deterministic.states.length).toBe(25);
    // First band point equals the shared branch state (zero initial spread).
    expect(a.bands.temperatureC[0]!.p90).toBeCloseTo(state.temperatureC, 9);
    for (const band of Object.values(a.bands)) {
      expect(band.length).toBeGreaterThan(0);
      for (const point of band) {
        expect(point.p90).toBeLessThanOrEqual(point.p50 + 1e-9);
        expect(point.p50).toBeLessThanOrEqual(point.p10 + 1e-9);
      }
    }
    // Spread exists and persists: members differ only in sampled parameters.
    const t = a.bands.temperatureC;
    expect(t[t.length - 1]!.p10 - t[t.length - 1]!.p90).toBeGreaterThan(0);
  });

  it('requires at least two members', () => {
    const { state } = baseState();
    const { staticColumns, dynamicColumns } = columns(20);
    expect(() =>
      forecastScenarioEnsemble({
        scenarioId: 'x',
        estimatedState: state,
        parameters: DEFAULT_PARAMETERS,
        dynamicParameters: DEFAULT_DYNAMIC_PARAMETERS,
        staticColumns: { A: [4] } as never,
        dynamicColumns,
        lifetimeYears: 30,
        schedule: BASE_SCHEDULE,
        startStep: 0,
        nSteps: 12,
      }),
    ).toThrow(RangeError);
    void staticColumns;
  });
});

function makeCycles(postMeanP: number[], postMeanT: number[]): TwinCycle[] {
  return postMeanP.map((p, i) => ({
    stepIndex: i * 12,
    timeYears: i,
    members: 30,
    channelsUsed: ['temperatureC', 'pressureBar'] as ('temperatureC' | 'pressureBar')[],
    priorErrT: 1,
    priorErrP: 0.5,
    postErrT: 1,
    postErrP: 0.5,
    freeErrT: 5,
    freeErrP: 3,
    priorSpreadT: 2,
    postSpreadT: 1,
    truthT: 220,
    truthP: 40,
    truthGen: 7,
    priorMeanT: 220,
    priorMeanP: 40,
    priorMeanGen: 7,
    postMeanT: postMeanT[i]!,
    postMeanP: p,
    postMeanGen: 7,
    freeMeanT: 220,
    freeMeanP: 40,
    freeMeanGen: 7,
    innovT: 0.5,
    innovP: 0.2,
    innovStdT: 2,
    innovStdP: 1,
  }));
}

function makeTelemetry(missingFraction: number): ChannelDiagnostics[] {
  const channels = ['temperatureC', 'pressureBar', 'productionKgS', 'injectionKgS', 'generationMWe'] as const;
  return channels.map((channel) => ({
    channel,
    unit: 'x',
    n: 100,
    nOk: Math.round(100 * (1 - missingFraction)),
    nMissing: Math.round(100 * missingFraction),
    nRejected: 0,
    rmse: 1,
    meanResidual: 0,
  }));
}

function healthyForecast(): ForecastResult {
  const { state, params } = baseState();
  return forecastFromState({ fromState: state, params, schedule: BASE_SCHEDULE, startStep: 0, nSteps: 24 });
}

describe('evaluateAlerts', () => {
  it('stays quiet on a flat healthy history', () => {
    const alerts = evaluateAlerts({
      cycles: makeCycles([40, 40, 40, 40, 40, 40], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(alerts).toEqual([]);
  });

  it('escalates sustained pressure decline from watch to warning', () => {
    const watch = evaluateAlerts({
      cycles: makeCycles([40, 37.5, 35, 32.5, 30, 27.5], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(watch.map((a) => a.id)).toContain('pressure-decline');
    expect(watch.find((a) => a.id === 'pressure-decline')!.severity).toBe('watch');
    const warning = evaluateAlerts({
      cycles: makeCycles([50, 44, 38, 32, 26, 20], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(warning.find((a) => a.id === 'pressure-decline')!.severity).toBe('warning');
    // Warnings sort before watches.
    const severities = warning.map((a) => a.severity);
    expect(severities).toEqual([...severities].sort());
  });

  it('flags thermal decline and floor proximity', () => {
    const thermal = evaluateAlerts({
      cycles: makeCycles([40, 40, 40, 40, 40, 40], [220, 218, 216, 214, 212, 210]),
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(thermal.map((a) => a.id)).toContain('thermal-decline');
    const nearFloor = evaluateAlerts({
      cycles: makeCycles([16, 15.2, 14.4, 13.6, 12.8, 12], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(nearFloor.find((a) => a.id === 'pressure-floor')!.severity).toBe('watch');
    const atFloor = evaluateAlerts({
      cycles: makeCycles([8, 7.5, 7, 6.5, 6, 5.5], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(atFloor.find((a) => a.id === 'pressure-floor')!.severity).toBe('warning');
  });

  it('flags gappy telemetry and overconfident filters', () => {
    const gaps = evaluateAlerts({
      cycles: makeCycles([40, 40, 40, 40, 40, 40], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0.3),
      forecast: healthyForecast(),
    });
    expect(gaps.map((a) => a.id)).toContain('observation-gaps');
    const overconfident = makeCycles([40, 40, 40, 40, 40, 40], [220, 220, 220, 220, 220, 220]).map((c) => ({
      ...c,
      innovT: 10,
      innovStdT: 1,
    }));
    const confident = evaluateAlerts({
      cycles: overconfident,
      telemetry: makeTelemetry(0),
      forecast: healthyForecast(),
    });
    expect(confident.map((a) => a.id)).toContain('filter-confidence');
  });

  it('warns when the baseline forecast exhausts the tank', () => {
    const { state, params } = baseState();
    const dying = forecastFromState({
      fromState: state,
      params,
      schedule: constantSchedule(5000, 0, 60),
      startStep: 0,
      nSteps: 120,
    });
    expect(dying.truncated).toBe(true);
    const alerts = evaluateAlerts({
      cycles: makeCycles([40, 40, 40, 40, 40, 40], [220, 220, 220, 220, 220, 220]),
      telemetry: makeTelemetry(0),
      forecast: dying,
    });
    const hit = alerts.find((a) => a.id === 'forecast-exhaustion')!;
    expect(hit.severity).toBe('warning');
    expect(hit.detail).toContain('years');
  });

  it('returns nothing for empty histories', () => {
    expect(evaluateAlerts({ cycles: [], telemetry: [], forecast: healthyForecast() })).toEqual([]);
  });
});

describe('summarizeOutlook', () => {
  it('reports a healthy outlook with no floor hit', () => {
    const outlook = summarizeOutlook('baseline', healthyForecast());
    expect(outlook.yearsToPressureFloor).toBeNull();
    expect(outlook.truncated).toBe(false);
    expect(outlook.cumulativeGenerationGWh).toBeGreaterThan(0);
    expect(outlook.minGenerationMWe).toBeLessThanOrEqual(outlook.endGenerationMWe + 1e-9);
    expect(outlook.scenarioId).toBe('baseline');
  });

  it('dates the floor hit under aggressive production', () => {
    const { state, params } = baseState();
    const dying = forecastFromState({
      fromState: state,
      params,
      schedule: constantSchedule(2000, 0, 60),
      startStep: 0,
      nSteps: 360,
    });
    const outlook = summarizeOutlook('high-production', dying);
    expect(outlook.yearsToPressureFloor).not.toBeNull();
    expect(outlook.yearsToPressureFloor!).toBeGreaterThan(0);
    // Easier rates last longer: monotonicity in production rate.
    const gentle = forecastFromState({
      fromState: state,
      params,
      schedule: constantSchedule(500, 0, 60),
      startStep: 0,
      nSteps: 360,
    });
    const gentleOutlook = summarizeOutlook('gentle', gentle);
    if (gentleOutlook.yearsToPressureFloor !== null) {
      expect(gentleOutlook.yearsToPressureFloor).toBeGreaterThanOrEqual(outlook.yearsToPressureFloor!);
    } else {
      expect(outlook.cumulativeGenerationGWh).toBeGreaterThan(0);
    }
  });
});
