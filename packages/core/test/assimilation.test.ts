import { describe, expect, it } from 'vitest';
import { mostLikelyInputs } from '../src/index.js';
import {
  combinedHeatCapacity,
  initialDynamicState,
  instantaneousCapacity,
  step,
  thermalEnergyFromTP,
} from '../src/dynamics/index.js';
import { zeroNoiseConfig, cloneTelemetryConfig } from '../src/telemetry/params.js';
import { mulberry32 } from '../src/rng.js';
import {
  ASSIMILATION_VERSION,
  STATE_DIM,
  columnMeans,
  crossCovariance,
  enkfAnalysis,
  enkfStream,
  invertSymmetric,
  matMul,
  posteriorToState,
  runTwinExperiment,
  type StateVector,
} from '../src/assimilation/index.js';

describe('linalg', () => {
  it('computes column means and cross-covariances', () => {
    const rows = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    expect(columnMeans(rows)).toEqual([3, 4]);
    const cxx = crossCovariance(rows, rows);
    expect(cxx[0]![0]).toBeCloseTo(4, 12);
    expect(cxx[0]![1]).toBeCloseTo(4, 12);
  });

  it('inverts 1x1 and 2x2 matrices', () => {
    expect(invertSymmetric([[4]])).toEqual([[0.25]]);
    const inv = invertSymmetric([
      [4, 1],
      [1, 3],
    ]);
    expect(inv[0]![0]).toBeCloseTo(3 / 11, 12);
    expect(inv[1]![1]).toBeCloseTo(4 / 11, 12);
    const id = matMul(
      [
        [4, 1],
        [1, 3],
      ],
      inv,
    );
    expect(id[0]![0]).toBeCloseTo(1, 12);
    expect(id[1]![1]).toBeCloseTo(1, 12);
    expect(id[0]![1]).toBeCloseTo(0, 12);
  });

  it('refuses a collapsed (singular) covariance loudly', () => {
    expect(() => invertSymmetric([[0]])).toThrow(RangeError);
    expect(() =>
      invertSymmetric([
        [1, 1],
        [1, 1],
      ]),
    ).toThrow(RangeError);
  });
});

describe('enkfAnalysis', () => {
  const forecast: StateVector[] = Array.from({ length: 20 }, (_, j) => [
    200 + j,
    40 + j * 0.5,
    2e11 - j * 1e9,
  ]);

  it('pulls the ensemble mean toward the observations', () => {
    const mean = (xs: number[]): number => xs.reduce((a, v) => a + v, 0) / xs.length;
    const priorT = mean(forecast.map((x) => x[0]));
    const { posterior } = enkfAnalysis(
      forecast,
      [
        { channel: 'temperatureC', value: 260, sigma: 1.5 },
        { channel: 'pressureBar', value: 60, sigma: 0.8 },
      ],
      mulberry32(1),
    );
    const postT = mean(posterior.map((x) => x[0]));
    // Prior mean T is 209.5; obs says 260 with tight sigma: posterior must move up.
    expect(postT).toBeGreaterThan(priorT + 10);
    expect(postT).toBeLessThan(260);
  });

  it('reduces spread and reports a 3x2 gain', () => {
    const sd = (xs: number[]): number => {
      const m = xs.reduce((a, v) => a + v, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
    };
    const { posterior, gain, channelsUsed } = enkfAnalysis(
      forecast,
      [{ channel: 'temperatureC', value: 215, sigma: 1.5 }],
      mulberry32(2),
    );
    expect(gain.length).toBe(STATE_DIM);
    expect(gain[0]!.length).toBe(1);
    expect(channelsUsed).toEqual(['temperatureC']);
    expect(sd(posterior.map((x) => x[0]))).toBeLessThan(sd(forecast.map((x) => x[0])));
  });

  it('passes the forecast through untouched when everything is missing', () => {
    const { posterior, gain, channelsUsed } = enkfAnalysis(forecast, [], mulberry32(3));
    expect(posterior).toEqual(forecast);
    expect(gain).toEqual([]);
    expect(channelsUsed).toEqual([]);
  });

  it('is deterministic for a stream and differs across streams', () => {
    const obs = [{ channel: 'temperatureC' as const, value: 215, sigma: 1.5 }];
    const a = enkfAnalysis(forecast, obs, enkfStream(42, 1));
    const b = enkfAnalysis(forecast, obs, enkfStream(42, 1));
    const c = enkfAnalysis(forecast, obs, enkfStream(42, 2));
    expect(a.posterior).toEqual(b.posterior);
    expect(c.posterior).not.toEqual(a.posterior);
  });

  it('isolates cycles: retuning one cycle leaves others bit-identical', () => {
    const obs = [{ channel: 'temperatureC' as const, value: 215, sigma: 1.5 }];
    const c1 = enkfAnalysis(forecast, obs, enkfStream(9, 1)).posterior;
    const c2 = enkfAnalysis(forecast, obs, enkfStream(9, 2)).posterior;
    // Same inputs, different cycle streams: both valid, generally different.
    expect(c1).not.toEqual(c2);
    // Same cycle stream twice: identical.
    expect(enkfAnalysis(forecast, obs, enkfStream(9, 1)).posterior).toEqual(c1);
  });

  it('accepts zero-noise observations and rejects negative sigmas', () => {
    // Perfect sensors are valid: perturbed observations equal the reading and
    // the gain trusts them fully.
    const { posterior } = enkfAnalysis(
      forecast,
      [{ channel: 'temperatureC', value: 215, sigma: 0 }],
      mulberry32(9),
    );
    expect(posterior.length).toBe(forecast.length);
    for (const x of posterior) for (const v of x) expect(Number.isFinite(v)).toBe(true);
    expect(() =>
      enkfAnalysis(forecast, [{ channel: 'temperatureC', value: 215, sigma: -1 }], mulberry32(1)),
    ).toThrow(RangeError);
  });

  it('rejects degenerate inputs loudly', () => {
    expect(() => enkfAnalysis([forecast[0]!], [], mulberry32(1))).toThrow(RangeError);
    expect(() =>
      enkfAnalysis(forecast, [{ channel: 'temperatureC', value: NaN, sigma: 1 }], mulberry32(1)),
    ).toThrow(RangeError);
  });
});

describe('extracted step helpers', () => {
  it('rebuild the same energy and capacity the step computes', () => {
    const inputs = mostLikelyInputs();
    const { state, params } = initialDynamicState(inputs, {
      totalCompressibilityPerBar: 8e-3,
      rechargeKgS: 2,
    });
    expect(thermalEnergyFromTP(state.temperatureC, state.pressureBar, params)).toBeCloseTo(
      state.thermalEnergyPj,
      9,
    );
    expect(
      combinedHeatCapacity(state.pressureBar, state.temperatureC, params),
    ).toBeGreaterThan(2500);
    const cap = instantaneousCapacity(state.temperatureC, state.pressureBar, 80, params);
    expect(Number.isFinite(cap)).toBe(true);
    expect(cap).toBeGreaterThan(0);
  });
});

describe('twin experiment', () => {
  const result = runTwinExperiment({ n: 30, seed: 42 });

  it('records provenance and a full cycle history', () => {
    expect(result.seed).toBe(42);
    expect(result.n).toBe(30);
    expect(result.assimilationVersion).toBe(ASSIMILATION_VERSION);
    expect(result.assimilationVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.dynamicsVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.cycles.length).toBe(31); // t=0 plus 30 yearly cycles
    expect(result.truth.length).toBe(361);
    expect(result.posteriorMean.length).toBe(31);
    expect(result.freeMean.length).toBe(31);
  });

  it('starts from an intentionally biased prior', () => {
    // +15 C bias dominates: initial prior error must be large.
    expect(result.cycles[0]!.priorErrT).toBeGreaterThan(10);
  });

  it('reduces state error versus the free-run control', () => {
    // Measured ~0.02–0.04 (T) and ~0.05–0.13 (p) across seeds; assert with margin.
    expect(result.errorRatioT).toBeLessThan(0.2);
    expect(result.errorRatioP).toBeLessThan(0.4);
    const last = result.cycles[result.cycles.length - 1]!;
    expect(last.postErrT).toBeLessThan(last.freeErrT);
    expect(last.postErrP).toBeLessThan(last.freeErrP);
  });

  it('collapses uncertainty while keeping every cycle physical', () => {
    const last = result.cycles[result.cycles.length - 1]!;
    expect(last.postSpreadT).toBeLessThan(result.cycles[0]!.priorSpreadT);
    for (const c of result.cycles) {
      expect(Number.isFinite(c.postMeanT)).toBe(true);
      expect(c.postMeanT).toBeGreaterThan(0);
      expect(c.postMeanT).toBeLessThan(350);
      expect(c.postMeanP).toBeGreaterThan(0);
    }
  });

  it('is exactly reproducible for a seed and sensitive to it', () => {
    const repeat = runTwinExperiment({ n: 30, seed: 42 });
    expect(repeat.cycles).toEqual(result.cycles);
    expect(repeat.errorRatioT).toBe(result.errorRatioT);
    const other = runTwinExperiment({ n: 30, seed: 43 });
    expect(other.errorRatioT).not.toBe(result.errorRatioT);
  });

  it('validates across seeds', () => {
    for (const seed of [7, 123]) {
      const r = runTwinExperiment({ n: 30, seed });
      expect(r.errorRatioT, `seed ${seed} T`).toBeLessThan(0.2);
      expect(r.errorRatioP, `seed ${seed} p`).toBeLessThan(0.4);
    }
  });

  it('rejects bad config loudly', () => {
    expect(() => runTwinExperiment({ n: 1 })).toThrow(RangeError);
    expect(() => runTwinExperiment({ assimilationIntervalSteps: 0 })).toThrow(RangeError);
  });

  it('runs a minimal two-member ensemble without collapsing', () => {
    const r = runTwinExperiment({ n: 2, seed: 42 });
    expect(r.cycles.length).toBe(31);
    const last = r.cycles[r.cycles.length - 1]!;
    expect(Number.isFinite(last.postErrT)).toBe(true);
    expect(last.postErrT).toBeLessThan(last.freeErrT);
  });
});

describe('posteriorToState', () => {
  const { state: template, params } = initialDynamicState(mostLikelyInputs(), {
    totalCompressibilityPerBar: 8e-3,
    rechargeKgS: 2,
  });

  it('rebuilds a consistent, step-able model state', () => {
    const vec: StateVector = [210, 38.5, 1.95e11];
    const rebuilt = posteriorToState(vec, template, params, 80);
    expect(rebuilt.temperatureC).toBe(210);
    expect(rebuilt.pressureBar).toBe(38.5);
    expect(rebuilt.fluidMassKg).toBe(1.95e11);
    // Energy matches the forward model's own formula exactly.
    expect(rebuilt.thermalEnergyPj).toBe(
      thermalEnergyFromTP(210, 38.5, params),
    );
    expect(rebuilt.capacityMweInstant).toBe(
      instantaneousCapacity(210, 38.5, 80, params),
    );
    // Clock and cumulative meters come from the forecast template untouched.
    expect(rebuilt.timeYears).toBe(template.timeYears);
    expect(rebuilt.cumulativeProducedKg).toBe(template.cumulativeProducedKg);
    // The rebuilt state feeds straight back into the dynamics.
    const next = step(rebuilt, { productionKgS: 80, injectionKgS: 56, injectionTemperatureC: 60 }, params, 365.25 * 24 * 3600 / 12);
    expect(Number.isFinite(next.state.temperatureC)).toBe(true);
    expect(next.state.pressureBar).toBeGreaterThan(0);
  });

  it('refuses unphysical posteriors loudly', () => {
    expect(() => posteriorToState([400, 38.5, 1.95e11], template, params, 80)).toThrow(RangeError);
    expect(() => posteriorToState([210, -3, 1.95e11], template, params, 80)).toThrow(RangeError);
    expect(() => posteriorToState([210, 38.5, 0], template, params, 80)).toThrow(RangeError);
    expect(() => posteriorToState([NaN, 38.5, 1.95e11], template, params, 80)).toThrow(RangeError);
  });
});

describe('observation regimes', () => {
  it('snaps to truth with perfect observations and never skips analysis', () => {
    const r = runTwinExperiment({ n: 30, seed: 42, telemetryConfig: zeroNoiseConfig() });
    expect(r.errorRatioT).toBeLessThan(0.01);
    expect(r.errorRatioP).toBeLessThan(0.01);
    expect(r.analysisSkipped).toBe(0);
    const last = r.cycles[r.cycles.length - 1]!;
    expect(last.postErrT).toBeLessThan(0.1);
  });

  it('still validates with 40% dropout on both channels', () => {
    const gap = cloneTelemetryConfig();
    gap.channels.temperatureC.dropoutRate = 0.4;
    gap.channels.pressureBar.dropoutRate = 0.4;
    const r = runTwinExperiment({ n: 30, seed: 42, telemetryConfig: gap });
    // Many cycles run on a single channel; the filter must still improve on free.
    const partial = r.cycles.filter((c) => c.channelsUsed.length === 1).length;
    expect(partial).toBeGreaterThan(0);
    expect(r.errorRatioT).toBeLessThan(0.3);
    const last = r.cycles[r.cycles.length - 1]!;
    expect(last.postErrT).toBeLessThan(last.freeErrT);
  });

  it('still validates with inflated sensor noise', () => {
    const noisy = cloneTelemetryConfig();
    noisy.channels.temperatureC.sigma = 8;
    noisy.channels.pressureBar.sigma = 5;
    const r = runTwinExperiment({ n: 30, seed: 42, telemetryConfig: noisy });
    expect(r.errorRatioT).toBeLessThan(0.3);
    expect(r.errorRatioP).toBeLessThan(0.9);
    const last = r.cycles[r.cycles.length - 1]!;
    expect(last.postErrT).toBeLessThan(last.freeErrT);
    expect(last.postErrP).toBeLessThan(last.freeErrP);
  });
});

describe('innovation diagnostics', () => {
  const r = runTwinExperiment({ n: 30, seed: 42 });

  it('records finite innovations with positive expected envelopes wherever used', () => {
    const used = r.cycles.filter((c) => c.channelsUsed.length > 0);
    expect(used.length).toBeGreaterThan(25);
    for (const c of used) {
      if (c.channelsUsed.includes('temperatureC')) {
        expect(Number.isFinite(c.innovT)).toBe(true);
        expect(c.innovStdT).toBeGreaterThan(0);
      } else {
        expect(c.innovT).toBeNull();
      }
    }
  });

  it('keeps most temperature innovations inside the expected 2-sigma envelope', () => {
    const withT = r.cycles.filter((c) => c.innovT !== null && c.innovStdT !== null);
    const inside = withT.filter((c) => Math.abs(c.innovT!) <= 2 * c.innovStdT!).length;
    // A healthy filter is conservative here (envelope includes prior spread).
    expect(inside / withT.length).toBeGreaterThan(0.8);
  });

  it('reports a clean bill of health on the default run', () => {
    expect(r.analysisSkipped).toBe(0);
    expect(r.totalFallbacks).toBeLessThanOrEqual(2);
  });
});
