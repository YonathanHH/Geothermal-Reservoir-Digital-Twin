/**
 * Twin experiment: truth → telemetry → EnKF → posterior → forecast (Phase 2).
 *
 * One synthetic truth (most-likely parameters) runs the full horizon while its
 * noisy wellhead telemetry is recorded. An ensemble of members — sampling the
 * full static + dynamic parameter uncertainty on bit-identical streams AND
 * starting from an intentionally biased initial temperature — forecasts with
 * the existing `step()` and is corrected at fixed intervals by the EnKF
 * analysis. A parallel free run of the same members (no assimilation) is the
 * control: the experiment succeeds when the posterior tracks truth better
 * than the free forecast does.
 *
 * Member exhaustion is handled per run: a member that depletes its tank drops
 * out of that run, and cycle metrics use members active in BOTH runs so the
 * comparison stays apples-to-apples. Posterior vectors that fail physical
 * validation keep their forecast and are counted as fallbacks.
 */

import { REGION1_MAX_C, REGION1_MIN_C } from '../steam/index.js';
import { DEFAULT_PARAMETERS, MODEL_VERSION, mostLikelyInputs, toResourceInputs } from '../model.js';
import { PARAMETER_KEYS, type ParameterKey, type ParameterSpec } from '../types.js';
import { initialDynamicState } from '../dynamics/init.js';
import { instantaneousCapacity, step, thermalEnergyFromTP } from '../dynamics/step.js';
import {
  DT_SECONDS,
  TOTAL_STEPS,
  controlsAt,
  defaultSchedule,
  type DynamicSchedule,
} from '../dynamics/schedule.js';
import {
  DEFAULT_DYNAMIC_PARAMETERS,
  DYNAMICS_VERSION,
} from '../dynamics/params.js';
import type {
  DynamicParameterKey,
  DynamicParameterSpec,
  DynamicParams,
  ReservoirState,
} from '../dynamics/types.js';
import { observeTrajectory } from '../telemetry/observe.js';
import { DEFAULT_TELEMETRY_CONFIG } from '../telemetry/params.js';
import type { TelemetryConfig } from '../telemetry/types.js';
import { enkfAnalysis, enkfStream } from './enkf.js';
import { ASSIMILATION_VERSION } from './params.js';
import type {
  AssimilatedObservation,
  StateVector,
  TwinCycle,
  TwinResult,
} from './types.js';
import { sampleEnsembleColumns } from '../dynamics/ensemble.js';

export interface TwinConfig {
  /** Ensemble members (≥ 2). */
  n?: number;
  /** Master seed: parameters, telemetry and filter streams all derive from it. */
  seed?: number;
  parameters?: Record<ParameterKey, ParameterSpec>;
  dynamicParameters?: Record<DynamicParameterKey, DynamicParameterSpec>;
  schedule?: DynamicSchedule;
  /** Steps between assimilation cycles (default 12 = yearly). */
  assimilationIntervalSteps?: number;
  /** Intentional initial-temperature bias of every member, °C (default 15). */
  initialTemperatureBiasC?: number;
  /** Sensor model for the truth's telemetry (and the filter's R). */
  telemetryConfig?: TelemetryConfig;
  /** Multiplicative covariance inflation (default 1 = off). */
  inflation?: number;
  label?: string;
}

interface Member {
  index: number;
  state: ReservoirState;
  params: DynamicParams;
  productionKgS: number;
  active: boolean;
}

/**
 * Rebuild a full member state from a posterior vector. Energy and capacity
 * are recomputed from (T, p) with the forward model's own formulas, so the
 * result is always a consistent, step-able model state. Counters and clock
 * come from the forecast template. Throws when unphysical — callers keep the
 * forecast and count a fallback instead of propagating garbage.
 */
export function posteriorToState(
  vec: StateVector,
  template: ReservoirState,
  params: DynamicParams,
  productionKgS: number,
): ReservoirState {
  const [t, p, m] = vec;
  if (!Number.isFinite(t) || !Number.isFinite(p) || !Number.isFinite(m)) {
    throw new RangeError(`twin: posterior vector is not finite (${vec}).`);
  }
  if (t <= REGION1_MIN_C || t >= REGION1_MAX_C) {
    throw new RangeError(`twin: posterior temperature ${t} left the liquid domain.`);
  }
  if (!(p > 0)) throw new RangeError(`twin: posterior pressure ${p} is not positive.`);
  if (!(m > 0)) throw new RangeError(`twin: posterior mass ${m} is not positive.`);
  return {
    timeYears: template.timeYears,
    temperatureC: t,
    pressureBar: p,
    fluidMassKg: m,
    thermalEnergyPj: thermalEnergyFromTP(t, p, params),
    cumulativeProducedKg: template.cumulativeProducedKg,
    cumulativeInjectedKg: template.cumulativeInjectedKg,
    capacityMweInstant: instantaneousCapacity(t, p, productionKgS, params),
  };
}

/** Shift an initial state's temperature by deltaC, rebuilding energy consistently. */
function applyTemperatureBias(
  state: ReservoirState,
  params: DynamicParams,
  deltaC: number,
): ReservoirState {
  const t = state.temperatureC + deltaC;
  if (t <= REGION1_MIN_C || t >= REGION1_MAX_C) {
    throw new RangeError(`twin: biased temperature ${t} left the liquid domain.`);
  }
  return {
    ...state,
    temperatureC: t,
    thermalEnergyPj: thermalEnergyFromTP(t, state.pressureBar, params),
    capacityMweInstant: instantaneousCapacity(
      t,
      state.pressureBar,
      0,
      params,
    ),
  };
}

function mean(values: number[]): number {
  return values.reduce((a, v) => a + v, 0) / Math.max(values.length, 1);
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

function meanAbsErr(members: Member[], truth: ReservoirState, pick: (s: ReservoirState) => number): number {
  if (members.length === 0) return NaN;
  return mean(members.map((mb) => Math.abs(pick(mb.state) - pick(truth))));
}

/** Run the full twin experiment and return truth, estimates and diagnostics. */
export function runTwinExperiment(config: TwinConfig = {}): TwinResult {
  const {
    n = 50,
    seed = 42,
    parameters = DEFAULT_PARAMETERS,
    dynamicParameters = DEFAULT_DYNAMIC_PARAMETERS,
    schedule = defaultSchedule(),
    assimilationIntervalSteps = 12,
    initialTemperatureBiasC = 15,
    telemetryConfig = DEFAULT_TELEMETRY_CONFIG,
    inflation = 1,
    label = 'Twin validation experiment',
  } = config;

  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError(`twin: n must be an integer >= 2, got ${n}.`);
  }
  if (!Number.isInteger(assimilationIntervalSteps) || assimilationIntervalSteps < 1) {
    throw new RangeError(`twin: assimilationIntervalSteps must be >= 1, got ${assimilationIntervalSteps}.`);
  }

  // Truth: most-likely everything, run once.
  const truthInputs = mostLikelyInputs(parameters, 30);
  const truthInit = initialDynamicState(truthInputs, {
    totalCompressibilityPerBar: dynamicParameters.cTotal.mostLikely,
    rechargeKgS: dynamicParameters.recharge.mostLikely,
  });
  const truth: ReservoirState[] = [truthInit.state];
  {
    let current = truthInit.state;
    for (let s = 0; s < TOTAL_STEPS; s++) {
      current = step(current, controlsAt(schedule, s), truthInit.params, DT_SECONDS).state;
      truth.push(current);
    }
  }
  const truthState = (s: number): ReservoirState => truth[Math.min(s, truth.length - 1)]!;

  // Truth telemetry, observed once with isolated sensor streams. Indexed by
  // step and channel once — the per-cycle lookup below runs 30×, not 30×1805.
  const truthTelemetry = observeTrajectory({
    states: truth,
    controlsAt: (s) => controlsAt(schedule, Math.min(s, TOTAL_STEPS - 1)),
    config: telemetryConfig,
    seed,
    trajectoryIndex: 0,
  });
  const truthByStep = new Map<number, Map<string, { observedValue: number | null; quality: string }>>();
  for (const p of truthTelemetry.points) {
    let byChannel = truthByStep.get(p.stepIndex);
    if (!byChannel) {
      byChannel = new Map();
      truthByStep.set(p.stepIndex, byChannel);
    }
    byChannel.set(p.channel, p);
  }
  const truthPoint = (stepIndex: number, channel: 'temperatureC' | 'pressureBar') =>
    truthByStep.get(stepIndex)?.get(channel);

  // Ensemble members: bit-identical parameter columns, biased initial temperature.
  const { staticColumns, dynamicColumns } = sampleEnsembleColumns(n, seed, parameters, dynamicParameters);
  const makeMembers = (): Member[] => {
    const members: Member[] = [];
    for (let i = 0; i < n; i++) {
      const values = Object.fromEntries(
        PARAMETER_KEYS.map((key) => [key, staticColumns[key]![i]]),
      ) as Record<ParameterKey, number>;
      try {
        const inputs = toResourceInputs(values, 30);
        const { state: initial, params } = initialDynamicState(inputs, {
          totalCompressibilityPerBar: dynamicColumns.cTotal![i]!,
          rechargeKgS: dynamicColumns.recharge![i]!,
        });
        members.push({
          index: i,
          state: applyTemperatureBias(initial, params, initialTemperatureBiasC),
          params,
          productionKgS: controlsAt(schedule, 0).productionKgS,
          active: true,
        });
      } catch {
        members.push({
          index: i,
          state: truth[0]!,
          params: truthInit.params,
          productionKgS: 0,
          active: false,
        });
      }
    }
    return members;
  };
  const assimMembers = makeMembers();
  const freeMembers: Member[] = assimMembers.map((mb) => ({
    ...mb,
    state: { ...mb.state },
  }));

  const stepMembers = (members: Member[], upto: number, from: number): void => {
    for (const mb of members) {
      if (!mb.active) continue;
      try {
        for (let s = from; s < upto; s++) {
          mb.state = step(mb.state, controlsAt(schedule, s), mb.params, DT_SECONDS).state;
        }
      } catch {
        mb.active = false;
      }
    }
  };

  const commonActive = (): { assim: Member[]; free: Member[] } => {
    const freeByIndex = new Map(freeMembers.filter((m) => m.active).map((m) => [m.index, m]));
    const assim: Member[] = [];
    const free: Member[] = [];
    for (const mb of assimMembers) {
      if (!mb.active) continue;
      const peer = freeByIndex.get(mb.index);
      if (!peer) continue;
      assim.push(mb);
      free.push(peer);
    }
    return { assim, free };
  };

  const cycles: TwinCycle[] = [];
  let totalFallbacks = 0;
  let analysisSkipped = 0;
  let cycleNumber = 0;
  // Prior snapshot of the assimilated members before each analysis.
  let priorSnapshot: Member[] = [];
  const snapshotPrior = (): void => {
    priorSnapshot = commonActive().assim.map((mb) => ({ ...mb, state: { ...mb.state } }));
  };

  interface CycleInnovations {
    innovT: number | null;
    innovP: number | null;
    innovStdT: number | null;
    innovStdP: number | null;
  }

  const recordCycle = (
    s: number,
    channelsUsed: ('temperatureC' | 'pressureBar')[],
    innovations: CycleInnovations = { innovT: null, innovP: null, innovStdT: null, innovStdP: null },
  ): void => {
    const truthS = truthState(s);
    const { assim, free } = commonActive();
    const pickT = (st: ReservoirState): number => st.temperatureC;
    const pickP = (st: ReservoirState): number => st.pressureBar;
    const pickG = (st: ReservoirState): number => st.capacityMweInstant;
    // Posterior metrics are measured on the current (post-analysis) states.
    cycles.push({
      stepIndex: s,
      timeYears: truthS.timeYears,
      members: assim.length,
      channelsUsed,
      priorErrT: meanAbsErr(priorSnapshot, truthS, pickT),
      priorErrP: meanAbsErr(priorSnapshot, truthS, pickP),
      postErrT: meanAbsErr(assim, truthS, pickT),
      postErrP: meanAbsErr(assim, truthS, pickP),
      freeErrT: meanAbsErr(free, truthS, pickT),
      freeErrP: meanAbsErr(free, truthS, pickP),
      priorSpreadT: std(priorSnapshot.map((mb) => mb.state.temperatureC)),
      postSpreadT: std(assim.map((mb) => mb.state.temperatureC)),
      truthT: truthS.temperatureC,
      truthP: truthS.pressureBar,
      truthGen: truthS.capacityMweInstant,
      priorMeanT: mean(priorSnapshot.map((mb) => mb.state.temperatureC)),
      priorMeanP: mean(priorSnapshot.map((mb) => mb.state.pressureBar)),
      priorMeanGen: mean(priorSnapshot.map((mb) => mb.state.capacityMweInstant)),
      postMeanT: mean(assim.map((mb) => mb.state.temperatureC)),
      postMeanP: mean(assim.map((mb) => mb.state.pressureBar)),
      postMeanGen: mean(assim.map((mb) => mb.state.capacityMweInstant)),
      freeMeanT: mean(free.map((mb) => mb.state.temperatureC)),
      freeMeanP: mean(free.map((mb) => mb.state.pressureBar)),
      freeMeanGen: mean(free.map((mb) => mb.state.capacityMweInstant)),
      ...innovations,
    });
  };

  // Initial cycle at t = 0 (prior error vs truth, no analysis yet).
  snapshotPrior();
  recordCycle(0, []);

  // Innovation diagnostics for one cycle: observation minus prior mean, with
  // the expected std sqrt(sample variance + R). Computed from the
  // pre-analysis snapshot so the numbers audit the forecast, not the update.
  const innovationsFor = (
    observations: readonly AssimilatedObservation[],
  ): { innovT: number | null; innovP: number | null; innovStdT: number | null; innovStdP: number | null } => {
    const out = { innovT: null as number | null, innovP: null as number | null, innovStdT: null as number | null, innovStdP: null as number | null };
    for (const o of observations) {
      const row = o.channel === 'temperatureC' ? 0 : 1;
      const vals = priorSnapshot.map((mb) =>
        row === 0 ? mb.state.temperatureC : mb.state.pressureBar,
      );
      if (vals.length < 2) continue;
      const m = mean(vals);
      const variance = vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1);
      const innov = o.value - m;
      const expectedStd = Math.sqrt(variance + o.sigma * o.sigma);
      if (o.channel === 'temperatureC') {
        out.innovT = innov;
        out.innovStdT = expectedStd;
      } else {
        out.innovP = innov;
        out.innovStdP = expectedStd;
      }
    }
    return out;
  };

  for (let s = 1; s <= TOTAL_STEPS; s++) {
    stepMembers(assimMembers, s, s - 1);
    stepMembers(freeMembers, s, s - 1);
    if (s % assimilationIntervalSteps !== 0) continue;
    cycleNumber++;
    snapshotPrior();
    // Gather usable wellhead observations of truth at this step.
    const observations: AssimilatedObservation[] = [];
    for (const channel of ['temperatureC', 'pressureBar'] as const) {
      const point = truthPoint(s, channel);
      if (point && point.quality === 'ok' && point.observedValue !== null) {
        observations.push({
          channel,
          value: point.observedValue,
          sigma: telemetryConfig.channels[channel].sigma,
        });
      }
    }
    if (observations.length > 0) {
      const active = assimMembers.filter((mb) => mb.active);
      const forecast = active.map(
        (mb): [number, number, number] => [mb.state.temperatureC, mb.state.pressureBar, mb.state.fluidMassKg],
      );
      try {
        const analysis = enkfAnalysis(forecast, observations, enkfStream(seed, cycleNumber), inflation);
        active.forEach((mb, j) => {
          try {
            mb.state = posteriorToState(analysis.posterior[j]!, mb.state, mb.params, mb.productionKgS);
          } catch {
            totalFallbacks++;
          }
        });
        recordCycle(s, analysis.channelsUsed, innovationsFor(observations));
      } catch {
        // Collapsed ensemble: keep the forecast. Counted separately from
        // posterior-validation fallbacks so a sick filter can't hide in them.
        analysisSkipped++;
        recordCycle(s, [], innovationsFor(observations));
      }
    } else {
      recordCycle(s, []);
    }
  }

  const final = cycles[cycles.length - 1]!;
  const ratio = (post: number, free: number): number => {
    if (!Number.isFinite(post) || !Number.isFinite(free)) return NaN;
    if (free === 0) return post === 0 ? 1 : Number.POSITIVE_INFINITY;
    return post / free;
  };

  return {
    label,
    seed,
    n,
    modelVersion: MODEL_VERSION,
    dynamicsVersion: DYNAMICS_VERSION,
    assimilationVersion: ASSIMILATION_VERSION,
    cycles,
    errorRatioT: ratio(final.postErrT, final.freeErrT),
    errorRatioP: ratio(final.postErrP, final.freeErrP),
    truth,
    posteriorMean: cycles.map((c) => ({
      ...truth[0]!,
      timeYears: c.timeYears,
      temperatureC: c.postMeanT,
      pressureBar: c.postMeanP,
      capacityMweInstant: c.postMeanGen,
    })),
    freeMean: cycles.map((c) => ({
      ...truth[0]!,
      timeYears: c.timeYears,
      temperatureC: c.freeMeanT,
      pressureBar: c.freeMeanP,
      capacityMweInstant: c.freeMeanGen,
    })),
    rejectedAssimilated: assimMembers.filter((m) => !m.active).length,
    rejectedFree: freeMembers.filter((m) => !m.active).length,
    totalFallbacks,
    analysisSkipped,
  };
}
