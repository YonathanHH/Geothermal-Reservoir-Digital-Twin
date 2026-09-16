import { describe, expect, it } from 'vitest';
import {
  calculateResource,
  mostLikelyInputs,
  runMonteCarlo,
  inputSeries,
  steam,
} from '../src/index.js';
import {
  DT_SECONDS,
  HORIZON_YEARS,
  TOTAL_STEPS,
  constantSchedule,
  controlsAt,
  defaultSchedule,
  stepwiseSchedule,
  initialDynamicState,
  initialPressureBar,
  runDynamicEnsemble,
  step,
  DEFAULT_DYNAMIC_PARAMETERS,
  DYNAMICS_VERSION,
  type Controls,
} from '../src/dynamics/index.js';
import type { ResourceInputs } from '../src/index.js';

const baseInputs = mostLikelyInputs();
const baseDyn = { totalCompressibilityPerBar: 8e-3, rechargeKgS: 2 };
const baseInit = () => initialDynamicState(baseInputs, baseDyn);
const baseControls: Controls = { productionKgS: 80, injectionKgS: 56, injectionTemperatureC: 60 };

function runTrajectory(inputs: ResourceInputs, controls: Controls, steps = TOTAL_STEPS, dt = DT_SECONDS) {
  const { state: initial, params } = initialDynamicState(inputs, baseDyn);
  const states = [initial];
  let current = initial;
  for (let s = 0; s < steps; s++) {
    current = step(current, controls, params, dt).state;
    states.push(current);
  }
  return { initial, params, states, final: current };
}

describe('schedule', () => {
  it('uses a 30-year horizon with a 1-month timestep', () => {
    expect(HORIZON_YEARS).toBe(30);
    expect(TOTAL_STEPS).toBe(360);
    expect(DT_SECONDS).toBeCloseTo((365.25 * 24 * 60 * 60) / 12, 6);
  });

  it('defaults to 80 kg/s produced and 56 kg/s injected at 60 degC', () => {
    expect(defaultSchedule().controls).toEqual({
      productionKgS: 80,
      injectionKgS: 56,
      injectionTemperatureC: 60,
    });
  });

  it('rejects out-of-range step indices and wrong-length stepwise schedules', () => {
    expect(() => controlsAt(defaultSchedule(), -1)).toThrow(RangeError);
    expect(() => controlsAt(defaultSchedule(), TOTAL_STEPS)).toThrow(RangeError);
    expect(() => stepwiseSchedule([baseControls])).toThrow(RangeError);
  });
});

describe('initialisation from the static model', () => {
  it('takes temperature and stored energy from the static chain', () => {
    const { state } = baseInit();
    expect(state.temperatureC).toBe(baseInputs.temperatureC);
    // Re-anchored at the hydrostatic initial pressure rather than 1.001 x psat,
    // so agreement with static QR is close but not exact (liquid properties
    // barely move with pressure).
    const qrPj = calculateResource(baseInputs).qrPj;
    expect(Math.abs(state.thermalEnergyPj - qrPj) / qrPj).toBeLessThan(0.01);
    expect(state.timeYears).toBe(0);
    expect(state.capacityMweInstant).toBe(0);
  });

  it('starts in the compressed-liquid region with positive fluid mass', () => {
    const { state } = baseInit();
    expect(state.pressureBar).toBeGreaterThan(steam.psatT(state.temperatureC));
    expect(state.fluidMassKg).toBeGreaterThan(0);
    expect(Number.isFinite(state.fluidMassKg)).toBe(true);
  });

  it('uses a hydrostatic column that grows with depth', () => {
    expect(initialPressureBar(220, 800)).toBeGreaterThan(initialPressureBar(220, 300));
  });

  it('rejects invalid dynamic values loudly', () => {
    expect(() => initialDynamicState(baseInputs, { ...baseDyn, totalCompressibilityPerBar: 0 })).toThrow(RangeError);
    expect(() => initialDynamicState(baseInputs, { ...baseDyn, rechargeKgS: -1 })).toThrow(RangeError);
    expect(() =>
      initialDynamicState({ ...baseInputs, areaKm2: -1 }, baseDyn),
    ).toThrow();
  });
});

describe('step guards', () => {
  it('rejects negative rates, bad injection temperature and non-positive dt', () => {
    const { state, params } = baseInit();
    expect(() => step(state, { ...baseControls, productionKgS: -1 }, params, DT_SECONDS)).toThrow(RangeError);
    expect(() => step(state, { ...baseControls, injectionKgS: -1 }, params, DT_SECONDS)).toThrow(RangeError);
    expect(() => step(state, { ...baseControls, injectionTemperatureC: 400 }, params, DT_SECONDS)).toThrow(RangeError);
    expect(() => step(state, baseControls, params, 0)).toThrow(RangeError);
    expect(() => step(state, baseControls, params, -100)).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const { state, params } = baseInit();
    expect(step(state, baseControls, params, DT_SECONDS)).toEqual(
      step(state, baseControls, params, DT_SECONDS),
    );
  });
});

describe('mass and energy balance', () => {
  it('conserves mass exactly over one step', () => {
    const { state, params } = baseInit();
    const { state: next, diagnostics } = step(state, baseControls, params, DT_SECONDS);
    const expected = (baseControls.injectionKgS - baseControls.productionKgS + params.rechargeKgS) * DT_SECONDS;
    expect(diagnostics.dMassKg).toBeCloseTo(expected, 6);
    expect(next.fluidMassKg - state.fluidMassKg).toBeCloseTo(expected, 6);
  });

  it('closes the energy books over one step', () => {
    const { state, params } = baseInit();
    const { diagnostics } = step(state, baseControls, params, DT_SECONDS);
    const expected =
      ((baseControls.injectionKgS * diagnostics.hInjKjKg +
        params.rechargeKgS * diagnostics.hRechargeKjKg -
        baseControls.productionKgS * diagnostics.hProdKjKg) * DT_SECONDS) / 1e12;
    expect(diagnostics.dEnergyPj).toBeCloseTo(expected, 9);
  });

  it('accumulates mass and metered flows over the full horizon', () => {
    const { initial, states, final } = runTrajectory(baseInputs, baseControls);
    const netRate = baseControls.injectionKgS - baseControls.productionKgS + baseDyn.rechargeKgS;
    expect(final.fluidMassKg - initial.fluidMassKg).toBeCloseTo(netRate * DT_SECONDS * TOTAL_STEPS, 4);
    expect(final.cumulativeProducedKg).toBeCloseTo(baseControls.productionKgS * DT_SECONDS * TOTAL_STEPS, 4);
    expect(final.cumulativeInjectedKg).toBeCloseTo(baseControls.injectionKgS * DT_SECONDS * TOTAL_STEPS, 4);
    expect(states).toHaveLength(TOTAL_STEPS + 1);
    expect(final.timeYears).toBeCloseTo(30, 9);
  });

  it('keeps every state finite along the baseline trajectory', () => {
    const { states } = runTrajectory(baseInputs, baseControls);
    for (const s of states) {
      for (const key of ['temperatureC', 'pressureBar', 'fluidMassKg', 'thermalEnergyPj', 'capacityMweInstant'] as const) {
        expect(Number.isFinite(s[key]), `${key} at t=${s.timeYears}`).toBe(true);
      }
      expect(s.pressureBar).toBeGreaterThan(0);
    }
  });
});

describe('static limit', () => {
  it('holds the reservoir constant with no production, injection or recharge', () => {
    const idle: Controls = { productionKgS: 0, injectionKgS: 0, injectionTemperatureC: 60 };
    const { state: initial, params } = initialDynamicState(baseInputs, {
      ...baseDyn,
      rechargeKgS: 0,
    });
    const { final } = (() => {
      let current = initial;
      for (let s = 0; s < TOTAL_STEPS; s++) current = step(current, idle, { ...params, rechargeKgS: 0 }, DT_SECONDS).state;
      return { final: current };
    })();
    expect(final.temperatureC).toBeCloseTo(initial.temperatureC, 9);
    expect(final.pressureBar).toBeCloseTo(initial.pressureBar, 9);
    expect(final.fluidMassKg).toBeCloseTo(initial.fluidMassKg, 9);
    expect(final.thermalEnergyPj).toBeCloseTo(initial.thermalEnergyPj, 9);
    expect(final.capacityMweInstant).toBe(0);
  });
});

describe('dt convergence', () => {
  it('converges as the timestep is refined', () => {
    const once = runTrajectory(baseInputs, baseControls, TOTAL_STEPS, DT_SECONDS).final;
    const twice = runTrajectory(baseInputs, baseControls, TOTAL_STEPS * 2, DT_SECONDS / 2).final;
    const four = runTrajectory(baseInputs, baseControls, TOTAL_STEPS * 4, DT_SECONDS / 4).final;
    const span = baseInputs.temperatureC - baseInputs.ambientTemperatureC;
    const errCoarse = Math.abs(once.temperatureC - four.temperatureC) / span;
    const errFine = Math.abs(twice.temperatureC - four.temperatureC) / span;
    // Explicit Euler: first-order, so halving dt must shrink the error.
    expect(errCoarse).toBeLessThan(0.02);
    expect(errFine).toBeLessThan(errCoarse);
    expect(Math.abs(once.pressureBar - four.pressureBar) / once.pressureBar).toBeLessThan(0.02);
  });
});

describe('qualitative behaviour', () => {
  it('declines in temperature, pressure and energy under net extraction', () => {
    const { initial, final } = runTrajectory(baseInputs, baseControls);
    expect(final.temperatureC).toBeLessThan(initial.temperatureC);
    expect(final.pressureBar).toBeLessThan(initial.pressureBar);
    expect(final.thermalEnergyPj).toBeLessThan(initial.thermalEnergyPj);
    expect(final.capacityMweInstant).toBeGreaterThan(0);
  });

  it('drops further when production is increased', () => {
    const low = runTrajectory(baseInputs, { ...baseControls, productionKgS: 40 }).final;
    const high = runTrajectory(baseInputs, { ...baseControls, productionKgS: 120 }).final;
    expect(high.pressureBar).toBeLessThan(low.pressureBar);
    expect(high.thermalEnergyPj).toBeLessThan(low.thermalEnergyPj);
    expect(high.temperatureC).toBeLessThan(low.temperatureC);
  });

  it('holds pressure higher when injection is increased at fixed production', () => {
    // A gentler 40 kg/s production keeps even the un-injected case well inside
    // the tank (venting 80 kg/s with no return would drain this demo tank).
    const controls = (injectionKgS: number): Controls => ({
      productionKgS: 40,
      injectionKgS,
      injectionTemperatureC: 60,
    });
    const vented = runTrajectory(baseInputs, controls(0)).final;
    const returned = runTrajectory(baseInputs, controls(36)).final;
    expect(returned.pressureBar).toBeGreaterThan(vented.pressureBar);
    expect(returned.fluidMassKg).toBeGreaterThan(vented.fluidMassKg);
  });

  it('repressurises under injection with no production', () => {
    const { initial, final } = runTrajectory(baseInputs, {
      productionKgS: 0,
      injectionKgS: 56,
      injectionTemperatureC: 60,
    });
    expect(final.pressureBar).toBeGreaterThan(initial.pressureBar);
    expect(final.fluidMassKg).toBeGreaterThan(initial.fluidMassKg);
  });
});

describe('dynamic ensemble', () => {
  it('records provenance and full trajectories', () => {
    const run = runDynamicEnsemble({ n: 10, seed: 42 });
    expect(run.seed).toBe(42);
    expect(run.n).toBe(10);
    expect(run.dynamicsVersion).toBe(DYNAMICS_VERSION);
    expect(Date.parse(run.timestamp)).not.toBeNaN();
    expect(run.trajectories).toHaveLength(10);
    expect(run.trajectories[0]!.states).toHaveLength(TOTAL_STEPS + 1);
    expect(run.finalCapacityMwe).toHaveLength(10);
  });

  it('is reproducible for a given seed and differs across seeds', () => {
    const a = runDynamicEnsemble({ n: 20, seed: 123 });
    const b = runDynamicEnsemble({ n: 20, seed: 123 });
    expect(a.finalTemperatureC).toEqual(b.finalTemperatureC);
    expect(a.finalPressureBar).toEqual(b.finalPressureBar);
    expect(a.trajectories[0]).toEqual(b.trajectories[0]);
    const c = runDynamicEnsemble({ n: 20, seed: 124 });
    expect(c.finalTemperatureC).not.toEqual(a.finalTemperatureC);
  });

  it('samples the same static columns as the static engine at the same seed', () => {
    const n = 50;
    const seed = 17;
    const dyn = runDynamicEnsemble({ n, seed });
    const mc = runMonteCarlo({ n, seed });
    // Trajectories that deplete their tank are rejected, so compare index by
    // index rather than array by array.
    expect(dyn.trajectories.length).toBeGreaterThan(0);
    for (const key of ['A', 'H', 'T', 'R', 'u', 'fi'] as const) {
      const series = inputSeries(mc, key);
      for (const t of dyn.trajectories) {
        expect(t.values[key]).toBe(series[t.index]!);
      }
    }
  });

  it('does not disturb other streams when one dynamic parameter is fixed', () => {
    const baseline = runDynamicEnsemble({ n: 30, seed: 17 });
    const fixed = runDynamicEnsemble({
      n: 30,
      seed: 17,
      dynamicParameters: {
        ...DEFAULT_DYNAMIC_PARAMETERS,
        cTotal: { ...DEFAULT_DYNAMIC_PARAMETERS.cTotal, distribution: 'Fixed' },
      },
    });
    // Fixing cTotal changes which extreme tanks survive, so match by index:
    // per-parameter streams mean shared indices draw identical values.
    const baseByIndex = new Map(baseline.trajectories.map((t) => [t.index, t]));
    let matched = 0;
    for (const t of fixed.trajectories) {
      const peer = baseByIndex.get(t.index);
      if (!peer) continue;
      expect(t.dynamicValues.recharge).toBe(peer.dynamicValues.recharge);
      expect(t.values.H).toBe(peer.values.H);
      matched++;
    }
    expect(matched).toBeGreaterThan(0);
  });

  it('rejects physically exhausted tanks with a step and a reason', () => {
    const run = runDynamicEnsemble({
      n: 5,
      seed: 1,
      schedule: constantSchedule(1000, 0, 60),
    });
    expect(run.rejected.length).toBeGreaterThan(0);
    for (const r of run.rejected) {
      expect(typeof r.reason).toBe('string');
      expect(r.step).toBeGreaterThanOrEqual(-1);
    }
  });

  it('rejects a sample count below two', () => {
    expect(() => runDynamicEnsemble({ n: 1 })).toThrow(RangeError);
  });
});
