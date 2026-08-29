/**
 * Summary statistics for a set of Monte Carlo realizations.
 *
 * Sample rather than population forms throughout: standard deviation uses the n-1
 * denominator, and skewness and kurtosis carry their sample-size correction factors.
 * These match the conventions spreadsheets use (STDEV, SKEW, KURT, PERCENTILE), which is
 * what most readers of a resource assessment will be comparing against.
 */

/** Arithmetic mean. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/** Sample standard deviation (n-1 denominator). */
export function stdev(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (n - 1));
}

/** Median (mean of the two central values for even n). */
export function median(xs: readonly number[]): number {
  return percentile(xs, 0.5);
}

/** Sample skewness, with the n/((n-1)(n-2)) correction. */
export function skew(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += ((x - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Sample excess kurtosis. */
export function kurt(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 4) return NaN;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += ((x - m) / s) ** 4;
  const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const b = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return a * sum - b;
}

/**
 * Percentile by linear interpolation between order statistics at rank `p * (n - 1)`.
 * `p` is a fraction in [0, 1].
 */
export function percentile(xs: readonly number[], p: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  if (p <= 0) return sorted[0]!;
  if (p >= 1) return sorted[n - 1]!;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (rank - lo) * (sorted[hi]! - sorted[lo]!);
}

export function min(xs: readonly number[]): number {
  let m = Infinity;
  for (const x of xs) if (x < m) m = x;
  return m;
}

export function max(xs: readonly number[]): number {
  let m = -Infinity;
  for (const x of xs) if (x > m) m = x;
  return m;
}

/**
 * The exceedance probabilities conventionally tabulated in a resource assessment.
 *
 * Read as "probability of achieving at least this capacity", so P90 is a conservative
 * estimate and P10 an optimistic one - the reverse of a plain percentile.
 */
export const EXCEEDANCE_LEVELS = [1, 0.95, 0.9, 0.75, 0.5, 0.25, 0.1, 0.05, 0] as const;

/** Value exceeded with probability `probability`, i.e. `percentile(values, 1 - probability)`. */
export function exceedance(xs: readonly number[], probability: number): number {
  return percentile(xs, 1 - probability);
}

export interface SummaryStatistics {
  /** Number of realizations. */
  n: number;
  mean: number;
  stdev: number;
  median: number;
  min: number;
  max: number;
  skew: number;
  kurt: number;
  /** Mean of ln(x). Useful because the capacity distribution is close to lognormal. */
  lnMean: number;
  /** Sample standard deviation of ln(x). */
  lnStdev: number;
  /** Exceedance table keyed by probability. */
  exceedance: { probability: number; value: number }[];
}

/** Compute the full summary block for a set of realizations. */
export function summarize(xs: readonly number[]): SummaryStatistics {
  const logs = xs.map((x) => Math.log(x));
  return {
    n: xs.length,
    mean: mean(xs),
    stdev: stdev(xs),
    median: median(xs),
    min: min(xs),
    max: max(xs),
    skew: skew(xs),
    kurt: kurt(xs),
    lnMean: mean(logs),
    lnStdev: stdev(logs),
    exceedance: EXCEEDANCE_LEVELS.map((probability) => ({
      probability,
      value: exceedance(xs, probability),
    })),
  };
}

/** Pearson product-moment correlation. */
export function correl(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Least-squares gradient of `ys` regressed on `xs`. The dependent series comes first,
 * matching the SLOPE(knownY, knownX) convention.
 */
export function slope(ys: readonly number[], xs: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxy += dx * (ys[i]! - my);
    sxx += dx * dx;
  }
  if (sxx === 0) return 0;
  return sxy / sxx;
}

/** Spearman rank correlation, for monotonic but nonlinear relationships. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  return correl(rank(xs), rank(ys));
}

/** Fractional ranks with ties averaged. */
function rank(xs: readonly number[]): number[] {
  const order = xs.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.index] = shared;
    i = j + 1;
  }
  return ranks;
}
