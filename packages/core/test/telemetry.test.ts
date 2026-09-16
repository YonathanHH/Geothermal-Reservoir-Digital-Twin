import { describe, expect, it } from 'vitest';
import { mostLikelyInputs } from '../src/index.js';
import {
  DT_SECONDS,
  TOTAL_STEPS,
  constantSchedule,
  initialDynamicState,
  step,
  runDynamicEnsemble,
  type Controls,
  type ReservoirState,
} from '../src/dynamics/index.js';
import {
  DEFAULT_TELEMETRY_CONFIG,
  TELEMETRY_CHANNELS,
  TELEMETRY_SOURCES,
  TELEMETRY_UNITS,
  TELEMETRY_VERSION,
  assertValidTelemetryConfig,
  cloneTelemetryConfig,
  gaussianSample,
  observeEnsemble,
  observeTrajectory,
  scheduleControlsForState,
  summarizeTelemetry,
  zeroNoiseConfig,
  type TelemetryConfig,
  type TelemetryPoint,
} from '../src/telemetry/index.js';
import { mulberry32 } from '../src/rng.js';

const baseDyn = { totalCompressibilityPerBar: 8e-3, rechargeKgS: 2 };
const schedule = constantSchedule(80, 56, 60);
const controlsForState = scheduleControlsForState(schedule);

function testTrajectory(controls: Controls = schedule.controls): {
  states: ReservoirState[];
} {
  const { state: initial, params } = initialDynamicState(mostLikelyInputs(), baseDyn);
  const states = [initial];
  let current = initial;
  for (let s = 0; s < TOTAL_STEPS; s++) {
    current = step(current, controls, params, DT_SECONDS).state;
    states.push(current);
  }
  return { states };
}

const { states } = testTrajectory();

function noisyConfig(): TelemetryConfig {
  return cloneTelemetryConfig(DEFAULT_TELEMETRY_CONFIG);
}

describe('gaussianSample', () => {
  it('produces standard-normal variates', () => {
    const rng = mulberry32(7);
    const draws = Array.from({ length: 20000 }, () => gaussianSample(rng));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / (draws.length - 1));
    expect(mean).toBeLessThan(0.05);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(sd).toBeGreaterThan(0.95);
    expect(sd).toBeLessThan(1.05);
    for (const d of draws.slice(0, 100)) expect(Number.isFinite(d)).toBe(true);
  });
});

describe('observeTrajectory basics', () => {
  it('emits one point per channel per sampled step with units and sources', () => {
    const run = observeTrajectory({ states, controlsAt: controlsForState, config: noisyConfig() });
    expect(run.points.length).toBe(states.length * TELEMETRY_CHANNELS.length);
    expect(run.telemetryVersion).toBe(TELEMETRY_VERSION);
    expect(run.telemetryVersion).toMatch(/^\d+\.\d+\.\d+$/);
    for (const p of run.points) {
      expect(TELEMETRY_CHANNELS).toContain(p.channel);
      expect(p.unit).toBe(TELEMETRY_UNITS[p.channel]);
      expect(p.source).toBe(TELEMETRY_SOURCES[p.channel]);
      expect(Number.isFinite(p.trueValue)).toBe(true);
      expect(Number.isFinite(p.timeYears)).toBe(true);
    }
  });

  it('groups well and plant channels as documented', () => {
    expect(TELEMETRY_SOURCES.temperatureC).toBe('PW-01');
    expect(TELEMETRY_SOURCES.pressureBar).toBe('PW-01');
    expect(TELEMETRY_SOURCES.productionKgS).toBe('PW-01');
    expect(TELEMETRY_SOURCES.injectionKgS).toBe('plant');
    expect(TELEMETRY_SOURCES.generationMWe).toBe('plant');
  });

  it('reports rate truth from the controls in effect', () => {
    const run = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: zeroNoiseConfig(),
    });
    const prod = run.points.filter((p) => p.channel === 'productionKgS');
    for (const p of prod) {
      expect(p.trueValue).toBe(80);
      expect(p.observedValue).toBe(80);
    }
  });
});

describe('zero-noise mode', () => {
  it('reproduces the true state exactly', () => {
    const run = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: zeroNoiseConfig(),
    });
    expect(run.points.length).toBeGreaterThan(0);
    for (const p of run.points) {
      expect(p.quality).toBe('ok');
      expect(p.reason).toBeNull();
      expect(p.observedValue).toBe(p.trueValue);
      expect(p.residual).toBe(0);
    }
    for (const d of run.diagnostics) {
      expect(d.nOk).toBe(d.n);
      expect(d.rmse).toBe(0);
      expect(d.meanResidual).toBe(0);
    }
  });
});

describe('determinism and stream isolation', () => {
  const runA = () =>
    observeTrajectory({ states, controlsAt: controlsForState, config: noisyConfig(), seed: 99 });

  it('reproduces the identical record for the same seed', () => {
    expect(runA().points).toEqual(runA().points);
  });

  it('changes observations with a different seed', () => {
    const other = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: noisyConfig(),
      seed: 100,
    });
    const pick = (run: { points: TelemetryPoint[] }) =>
      run.points.filter((p) => p.channel === 'temperatureC' && p.quality === 'ok').map((p) => p.observedValue);
    expect(pick(other)).not.toEqual(pick(runA()));
  });

  it('isolates channels: retuning one sensor leaves the others bit-identical', () => {
    const baseline = runA().points;
    const altered = cloneTelemetryConfig();
    altered.channels.temperatureC.sigma = 9.9;
    altered.channels.temperatureC.dropoutRate = 0.3;
    const retuned = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: altered,
      seed: 99,
    }).points;
    for (const channel of ['pressureBar', 'productionKgS', 'injectionKgS', 'generationMWe'] as const) {
      expect(retuned.filter((p) => p.channel === channel)).toEqual(
        baseline.filter((p) => p.channel === channel),
      );
    }
  });

  it('draws noise independently of the true values', () => {
    // Same streams, different truth: residuals must match (no rejection at small sigma).
    const tight = cloneTelemetryConfig();
    for (const c of TELEMETRY_CHANNELS) {
      tight.channels[c] = { sigma: 0.01, bias: 0, dropoutRate: 0 };
    }
    const shifted = states.map((s) => ({ ...s, temperatureC: s.temperatureC + 40 }));
    const r1 = observeTrajectory({ states, controlsAt: controlsForState, config: tight, seed: 5 });
    const r2 = observeTrajectory({ states: shifted, controlsAt: controlsForState, config: tight, seed: 5 });
    const res = (run: { points: TelemetryPoint[] }, ch: (typeof TELEMETRY_CHANNELS)[number]) =>
      run.points.filter((p) => p.channel === ch).map((p) => p.residual);
    for (const channel of ['pressureBar', 'productionKgS', 'generationMWe'] as const) {
      expect(res(r2, channel)).toEqual(res(r1, channel));
    }
  });

  it('separates trajectories: trajectoryIndex selects independent streams', () => {
    const t0 = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: noisyConfig(),
      seed: 42,
      trajectoryIndex: 0,
    });
    const t1 = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: noisyConfig(),
      seed: 42,
      trajectoryIndex: 1,
    });
    const obs = (run: { points: TelemetryPoint[] }) => run.points.map((p) => p.observedValue);
    expect(obs(t1)).not.toEqual(obs(t0));
    // …but each index reproduces itself.
    expect(
      observeTrajectory({
        states,
        controlsAt: controlsForState,
        config: noisyConfig(),
        seed: 42,
        trajectoryIndex: 1,
      }).points,
    ).toEqual(t1.points);
  });
});

describe('noise behaviour', () => {
  it('adds bias recoverably and noise at roughly the configured sigma', () => {
    const config = zeroNoiseConfig();
    config.channels.temperatureC = { sigma: 1.5, bias: 2.5, dropoutRate: 0 };
    const run = observeTrajectory({ states, controlsAt: controlsForState, config, seed: 11 });
    const diag = run.diagnostics.find((d) => d.channel === 'temperatureC')!;
    expect(diag.nOk).toBe(states.length);
    expect(diag.meanResidual!).toBeCloseTo(2.5, 0);
    // RMSE^2 ≈ sigma^2 + bias^2 = 2.25 + 6.25 = 8.5 → RMSE ≈ 2.9 ± sampling wiggle.
    expect(diag.rmse!).toBeGreaterThan(2.4);
    expect(diag.rmse!).toBeLessThan(3.4);
  });

  it('matches configured sigma statistically per channel', () => {
    const run = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: noisyConfig(),
      seed: 42,
    });
    for (const d of run.diagnostics) {
      const sigma = DEFAULT_TELEMETRY_CONFIG.channels[d.channel].sigma;
      expect(d.rmse!).toBeGreaterThan(sigma * 0.7);
      expect(d.rmse!).toBeLessThan(sigma * 1.4);
      expect(Math.abs(d.meanResidual!)).toBeLessThan(sigma * 0.5);
    }
  });
});

describe('missing and rejected observations', () => {
  it('flags dropouts explicitly while the record keeps its shape', () => {
    const config = zeroNoiseConfig();
    config.channels.pressureBar.dropoutRate = 0.5;
    const run = observeTrajectory({ states, controlsAt: controlsForState, config, seed: 3 });
    const press = run.points.filter((p) => p.channel === 'pressureBar');
    expect(press.length).toBe(states.length);
    const missing = press.filter((p) => p.quality === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.length).toBeLessThan(press.length);
    for (const p of missing) {
      expect(p.observedValue).toBeNull();
      expect(p.residual).toBeNull();
      expect(p.reason).toBe('dropout');
    }
    // Untouched channels stay complete.
    const temp = run.points.filter((p) => p.channel === 'temperatureC');
    expect(temp.every((p) => p.quality === 'ok')).toBe(true);
  });

  it('rejects implausible readings instead of passing them on', () => {
    const config = zeroNoiseConfig();
    config.channels.temperatureC.bias = 1000; // far outside the liquid domain
    const run = observeTrajectory({ states, controlsAt: controlsForState, config, seed: 3 });
    const temp = run.points.filter((p) => p.channel === 'temperatureC');
    expect(temp.length).toBeGreaterThan(0);
    expect(temp.every((p) => p.quality === 'rejected')).toBe(true);
    for (const p of temp) {
      expect(p.observedValue).toBeNull();
      expect(p.reason).toBe('out-of-range');
    }
    const diag = run.diagnostics.find((d) => d.channel === 'temperatureC')!;
    expect(diag.nRejected).toBe(temp.length);
    expect(diag.rmse).toBeNull();
  });

  it('summarizes counts consistently', () => {
    const run = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: noisyConfig(),
      seed: 42,
    });
    for (const d of run.diagnostics) {
      expect(d.nOk + d.nMissing + d.nRejected).toBe(d.n);
    }
    expect(summarizeTelemetry(run.points)).toEqual(run.diagnostics);
  });
});

describe('cadence', () => {
  it('observes every step at cadence 1 with state timestamps', () => {
    const run = observeTrajectory({
      states,
      controlsAt: controlsForState,
      config: noisyConfig(),
    });
    for (const channel of TELEMETRY_CHANNELS) {
      const mine = run.points.filter((p) => p.channel === channel);
      expect(mine.length).toBe(states.length);
      mine.forEach((p, i) => {
        expect(p.stepIndex).toBe(i);
        expect(p.timeYears).toBe(states[i]!.timeYears);
      });
    }
  });

  it('subsamples at coarser cadences without changing the schema', () => {
    const config = { ...noisyConfig(), cadenceSteps: 3 };
    const run = observeTrajectory({ states, controlsAt: controlsForState, config });
    const expected = Math.floor(TOTAL_STEPS / 3) + 1;
    for (const channel of TELEMETRY_CHANNELS) {
      const mine = run.points.filter((p) => p.channel === channel);
      expect(mine.length).toBe(expected);
      expect(mine[0]!.stepIndex).toBe(0);
      expect(mine[1]!.stepIndex).toBe(3);
    }
  });

  it('rejects invalid configurations loudly', () => {
    expect(() => assertValidTelemetryConfig({ ...noisyConfig(), cadenceSteps: 0 })).toThrow(RangeError);
    const badSigma = cloneTelemetryConfig();
    badSigma.channels.temperatureC.sigma = -1;
    expect(() => assertValidTelemetryConfig(badSigma)).toThrow(RangeError);
    const badDrop = cloneTelemetryConfig();
    badDrop.channels.pressureBar.dropoutRate = 1;
    expect(() => assertValidTelemetryConfig(badDrop)).toThrow(RangeError);
    expect(() => observeTrajectory({ states, controlsAt: controlsForState, config: badSigma })).toThrow(RangeError);
  });
});

describe('immutability', () => {
  it('never mutates the trajectory it observes', () => {
    const before = JSON.stringify(states);
    const frozen = states.map((s) => Object.freeze({ ...s }));
    Object.freeze(frozen);
    const run = observeTrajectory({
      states: frozen,
      controlsAt: controlsForState,
      config: noisyConfig(),
      seed: 8,
    });
    expect(JSON.stringify(frozen)).toBe(before);
    expect(run.points.length).toBe(frozen.length * TELEMETRY_CHANNELS.length);
  });
});

describe('observeEnsemble', () => {
  it('observes each trajectory on its own stable streams', () => {
    const ensemble = runDynamicEnsemble({ n: 10, seed: 21 });
    const runs = observeEnsemble(ensemble, noisyConfig(), 77);
    expect(runs.length).toBe(ensemble.trajectories.length);
    // Identical to observing each trajectory individually by index.
    const first = ensemble.trajectories[0]!;
    const solo = observeTrajectory({
      states: first.states,
      controlsAt: scheduleControlsForState(ensemble.schedule),
      config: noisyConfig(),
      seed: 77,
      trajectoryIndex: first.index,
    });
    expect(runs[0]!.points).toEqual(solo.points);
  });

  it('is reproducible for the same seed', () => {
    const ensemble = runDynamicEnsemble({ n: 10, seed: 21 });
    const a = observeEnsemble(ensemble, noisyConfig(), 77);
    const b = observeEnsemble(ensemble, noisyConfig(), 77);
    // Timestamps differ by construction; everything scientific must match.
    expect(a.map((r) => r.points)).toEqual(b.map((r) => r.points));
    expect(a.map((r) => r.diagnostics)).toEqual(b.map((r) => r.diagnostics));
  });
});
