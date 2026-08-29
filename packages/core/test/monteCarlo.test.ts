import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARAMETERS,
  EXCEEDANCE_LEVELS,
  betaCdf,
  betaInv,
  compareScenarios,
  histogram,
  inputSeries,
  mulberry32,
  pert,
  pertShape,
  runMonteCarlo,
  runScenario,
  sensitivity,
  summarize,
  triangular,
  uniform,
} from '../src/index.js';

describe('runMonteCarlo', () => {
  it('is reproducible for a given seed', () => {
    const a = runMonteCarlo({ n: 200, seed: 123 });
    const b = runMonteCarlo({ n: 200, seed: 123 });
    expect(a.capacityMwe).toEqual(b.capacityMwe);
    expect(a.runId).toBe(b.runId);
  });

  it('produces different results for different seeds', () => {
    const a = runMonteCarlo({ n: 200, seed: 1 });
    const b = runMonteCarlo({ n: 200, seed: 2 });
    expect(a.capacityMwe).not.toEqual(b.capacityMwe);
  });

  it('returns the requested number of realizations', () => {
    const run = runMonteCarlo({ n: 500, seed: 9 });
    expect(run.realizations).toHaveLength(500);
    expect(run.capacityMwe).toHaveLength(500);
    expect(run.rejected).toHaveLength(0);
  });

  it('records the provenance needed to reproduce the run', () => {
    const run = runMonteCarlo({ n: 50, seed: 7, label: 'test' });
    expect(run.seed).toBe(7);
    expect(run.n).toBe(50);
    expect(run.modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Date.parse(run.timestamp)).not.toBeNaN();
    expect(run.parameters).toBeDefined();
  });

  it('keeps sampled inputs as well as outputs for every realization', () => {
    const run = runMonteCarlo({ n: 20, seed: 3 });
    for (const realization of run.realizations) {
      expect(realization.values.A).toBeDefined();
      expect(realization.outputs.ctKjM3C).toBeGreaterThan(0);
      expect(realization.outputs.capacityMwe).toBe(run.capacityMwe[realization.index]);
    }
  });

  it('honours the declared bounds of every sampled parameter', () => {
    const run = runMonteCarlo({ n: 2000, seed: 11 });
    for (const key of ['A', 'H', 'T', 'R', 'u', 'fi'] as const) {
      const spec = DEFAULT_PARAMETERS[key];
      for (const value of inputSeries(run, key)) {
        expect(value).toBeGreaterThanOrEqual(spec.min);
        expect(value).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('holds Fixed parameters constant at their most-likely value', () => {
    const run = runMonteCarlo({ n: 100, seed: 5 });
    for (const key of ['CR', 'D', 'Ta', 'F'] as const) {
      const unique = new Set(inputSeries(run, key));
      expect(unique.size).toBe(1);
      expect([...unique][0]).toBe(DEFAULT_PARAMETERS[key].mostLikely);
    }
  });

  /**
   * Fixed inputs consume no randomness, so fixing one must not shift the draws of the
   * others. This is what lets a scenario comparison isolate the effect of a change.
   */
  it('does not disturb other parameters when one is made Fixed', () => {
    const baseline = runMonteCarlo({ n: 100, seed: 17 });
    const withFixedArea = runMonteCarlo({
      n: 100,
      seed: 17,
      parameters: { ...DEFAULT_PARAMETERS, A: { ...DEFAULT_PARAMETERS.A, distribution: 'Fixed' } },
    });
    expect(inputSeries(withFixedArea, 'H')).toEqual(inputSeries(baseline, 'H'));
    expect(inputSeries(withFixedArea, 'T')).toEqual(inputSeries(baseline, 'T'));
  });

  it('rejects a sample count below two', () => {
    expect(() => runMonteCarlo({ n: 1 })).toThrow(RangeError);
    expect(() => runMonteCarlo({ n: 10.5 })).toThrow(RangeError);
  });
});

describe('Beta-PERT sampling', () => {
  it('reduces to alpha = beta = 3 in the symmetric case', () => {
    const { alpha, beta, mean } = pertShape(0.4, 0.35, 0.45);
    expect(alpha).toBeCloseTo(3, 12);
    expect(beta).toBeCloseTo(3, 12);
    expect(mean).toBeCloseTo(0.4, 12);
  });

  /**
   * The symmetric test cannot use exact equality: `(0.35 + 4*0.4 + 0.45) / 6` is
   * 0.4000000000000001 in IEEE-754, not 0.4. Falling through that branch computes the
   * shape parameters from a ratio of two rounding errors, which can be negative.
   */
  it('detects symmetry despite floating-point error', () => {
    for (const [ml, lo, hi] of [
      [0.4, 0.35, 0.45],
      [0.1, 0.05, 0.15],
      [0.3, 0.1, 0.5],
      [220, 160, 280],
    ] as const) {
      const { alpha, beta } = pertShape(ml, lo, hi);
      expect(alpha).toBeGreaterThan(0);
      expect(beta).toBeGreaterThan(0);
    }
  });

  it('skews the shape parameters for an asymmetric estimate', () => {
    // Most-likely near the lower bound should push mass left: alpha < beta.
    const low = pertShape(2, 1, 10);
    expect(low.alpha).toBeLessThan(low.beta);
    const high = pertShape(9, 1, 10);
    expect(high.alpha).toBeGreaterThan(high.beta);
  });

  it('gives the PERT mean four times the weight of the bounds', () => {
    expect(pertShape(2, 1, 10).mean).toBeCloseTo((1 + 8 + 10) / 6, 12);
  });

  it('converges on the PERT mean when sampled', () => {
    const rng = mulberry32(99);
    const draws = Array.from({ length: 20000 }, () => pert(rng, 2, 1, 10));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeCloseTo(pertShape(2, 1, 10).mean, 1);
  });

  /**
   * The whole point of PERT over a uniform draw is that the most-likely value carries
   * weight. A sampler that ignored it - for instance by applying the forward CDF
   * instead of its inverse - would degenerate to uniform here and pass every bounds
   * check while silently inflating the spread.
   */
  it('is more concentrated than a uniform draw over the same range', () => {
    const rng = mulberry32(3);
    const sd = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
    };
    const pertDraws = Array.from({ length: 20000 }, () => pert(rng, 5, 0, 10));
    const uniformDraws = Array.from({ length: 20000 }, () => uniform(rng, 0, 10));
    expect(sd(pertDraws)).toBeLessThan(sd(uniformDraws) * 0.75);
    // Beta(3,3) on [0,10] has sd = 10 * sqrt(3*3/((6^2)*7)) ~ 1.89.
    expect(sd(pertDraws)).toBeCloseTo(1.89, 1);
  });

  it('stays strictly within its bounds', () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 5000; i++) {
      const v = pert(rng, 2, 1, 10);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('rejects a three-point estimate that is not ordered', () => {
    expect(() => pertShape(3, 1, 2)).toThrow(RangeError);
    expect(() => pertShape(0.5, 1, 2)).toThrow(RangeError);
    expect(() => pertShape(1.5, 2, 2)).toThrow(RangeError);
  });

  it('inverts betaCdf correctly for asymmetric shapes', () => {
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      expect(betaCdf(betaInv(p, 2, 5), 2, 5)).toBeCloseTo(p, 10);
    }
  });

  it('draws triangular variates within range and around the mode', () => {
    const rng = mulberry32(4);
    const draws = Array.from({ length: 5000 }, () => triangular(rng, 2, 1, 4));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...draws)).toBeLessThanOrEqual(4);
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    // Theoretical mean is (1 + 2 + 4)/3.
    expect(mean).toBeCloseTo(7 / 3, 1);
  });
});

describe('statistics', () => {
  const run = runMonteCarlo({ n: 1000, seed: 42 });
  const stats = summarize(run.capacityMwe);

  it('reports every summary field', () => {
    expect(stats.n).toBe(1000);
    for (const key of ['mean', 'stdev', 'median', 'skew', 'kurt', 'lnMean', 'lnStdev'] as const) {
      expect(Number.isFinite(stats[key]), key).toBe(true);
    }
    expect(stats.exceedance).toHaveLength(EXCEEDANCE_LEVELS.length);
  });

  it('orders the exceedance table from conservative to optimistic', () => {
    // Higher probability of achievement means a lower capacity.
    const values = stats.exceedance.map((e) => e.value);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    }
  });

  it('places P90 below the median and P10 above it', () => {
    const at = (p: number) => stats.exceedance.find((e) => e.probability === p)!.value;
    expect(at(0.9)).toBeLessThan(stats.median);
    expect(at(0.1)).toBeGreaterThan(stats.median);
  });

  it('is reproducible for a fixed seed', () => {
    expect(summarize(runMonteCarlo({ n: 1000, seed: 42 }).capacityMwe)).toEqual(stats);
  });

  it('produces a right-skewed capacity distribution', () => {
    // A product of bounded positive factors is approximately lognormal.
    expect(stats.skew).toBeGreaterThan(0);
    expect(stats.mean).toBeGreaterThan(stats.median);
  });
});

describe('histogram', () => {
  const run = runMonteCarlo({ n: 1000, seed: 42 });
  const hist = histogram(run.capacityMwe);

  it('builds 20 bins spanning the full sample', () => {
    expect(hist.bins).toHaveLength(20);
    expect(hist.bins[0]!.lower).toBeCloseTo(Math.min(...run.capacityMwe), 12);
    expect(hist.bins[19]!.upper).toBeCloseTo(Math.max(...run.capacityMwe), 12);
  });

  it('assigns every value to exactly one bin', () => {
    const total = hist.bins.reduce((sum, b) => sum + b.count, 0) + hist.more;
    expect(total).toBe(run.capacityMwe.length);
  });

  it('produces cumulative and reverse cumulative columns that sum to one', () => {
    for (const bin of hist.bins) {
      expect(bin.cumulative + bin.reverseCumulative).toBeCloseTo(1, 12);
    }
    expect(hist.bins[19]!.cumulative).toBeCloseTo(1, 12);
  });

  it('labels the most likely range as the modal bin', () => {
    const peak = hist.bins.reduce((a, b) => (b.count > a.count ? b : a));
    expect(hist.mostLikelyRange).toBe(peak.label);
  });
});

describe('sensitivity', () => {
  const run = runMonteCarlo({ n: 2000, seed: 8 });
  const entries = sensitivity(run);

  it('reports zero correlation for Fixed parameters', () => {
    for (const entry of entries.filter((e) => !e.varies)) {
      expect(entry.correlation).toBe(0);
      expect(entry.slope).toBe(0);
    }
  });

  it('normalises correlations to sum to one', () => {
    const total = entries.reduce((sum, e) => sum + e.normalizedCorrelation, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('expresses fractional inputs per percentage point', () => {
    const recovery = entries.find((e) => e.key === 'R')!;
    expect(recovery.slopeUnit).toBe('MWe/%');
    // Capacity is proportional to recovery, so MWe per whole fraction is large; per
    // percentage point it must be two orders of magnitude smaller.
    const perFraction = recovery.slope * 100;
    expect(perFraction / recovery.slope).toBeCloseTo(100, 6);
  });

  it('gives every varying input a positive correlation with capacity', () => {
    // Increasing any of these can only increase the resource or its conversion.
    for (const entry of entries.filter((e) => e.varies)) {
      expect(entry.correlation, entry.key).toBeGreaterThan(0);
    }
  });

  it('identifies the largest-range inputs as dominant drivers', () => {
    const top = entries
      .filter((e) => e.varies)
      .sort((a, b) => b.correlation - a.correlation)
      .slice(0, 4)
      .map((e) => e.key);
    expect(top).toContain('R');
    expect(top).toContain('T');
  });
});

describe('scenarios', () => {
  it('applies overrides as a diff against the baseline', () => {
    const result = runScenario(
      { id: 's', label: 'Half recovery', overrides: { R: { min: 0.025, mostLikely: 0.06, max: 0.1 } } },
      { n: 500, seed: 2 },
    );
    expect(result.run.parameters.R.max).toBe(0.1);
    // Untouched parameters keep their baseline values.
    expect(result.run.parameters.A.max).toBe(DEFAULT_PARAMETERS.A.max);
  });

  it('halves capacity when the recovery factor is halved', () => {
    const halved = Object.fromEntries(
      (['min', 'mostLikely', 'max'] as const).map((f) => [f, DEFAULT_PARAMETERS.R[f] / 2]),
    );
    const base = runScenario({ id: 'b', label: 'Base', overrides: {} }, { n: 1000, seed: 2 });
    const half = runScenario({ id: 'h', label: 'Half', overrides: { R: halved } }, { n: 1000, seed: 2 });
    expect(half.statistics.mean / base.statistics.mean).toBeCloseTo(0.5, 6);
  });

  it('lowers average capacity for a longer project life', () => {
    const short = runScenario({ id: 'a', label: '30y', overrides: {} }, { n: 500, seed: 4 });
    const long = runScenario({ id: 'b', label: '60y', overrides: {}, lifetimeYears: 60 }, { n: 500, seed: 4 });
    expect(long.statistics.mean).toBeLessThan(short.statistics.mean);
  });

  it('compares two scenarios metric by metric', () => {
    const a = runScenario({ id: 'a', label: 'A', overrides: {} }, { n: 300, seed: 6 });
    const b = runScenario({ id: 'b', label: 'B', overrides: {}, lifetimeYears: 60 }, { n: 300, seed: 6 });
    const rows = compareScenarios(a, b);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.delta).toBeCloseTo(row.candidate - row.baseline, 12);
    }
    expect(rows.find((r) => r.metric === 'Mean')!.delta).toBeLessThan(0);
  });
});
