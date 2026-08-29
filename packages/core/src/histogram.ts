/**
 * Histogram and cumulative curves for the capacity distribution.
 *
 * 20 equal-width bins spanning the sample minimum to maximum. Binning is
 * upper-inclusive: a value falls in the first bin whose upper edge it does not exceed,
 * so the first bin also captures the minimum itself. A trailing `more` bucket catches
 * anything above the last edge - normally empty, since that edge is the sample maximum,
 * but floating-point equality is not guaranteed, so it is kept rather than folded away.
 */

export interface HistogramBin {
  /** Lower edge of the bin (exclusive, except for the first bin). */
  lower: number;
  /** Upper edge of the bin (inclusive). */
  upper: number;
  /** Human-readable range, e.g. "4.4 to 5.6". */
  label: string;
  count: number;
  /** Fraction of the sample at or below `upper`. */
  cumulative: number;
  /** 1 - cumulative, i.e. the exceedance probability. */
  reverseCumulative: number;
}

export interface Histogram {
  bins: HistogramBin[];
  /** Count above the final edge. */
  more: number;
  binSize: number;
  /** Label of the most populated bin. */
  mostLikelyRange: string;
}

/** Default bin count. */
export const DEFAULT_BIN_COUNT = 20;

/** Round to one decimal, half away from zero. Used for bin labels. */
function round1(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) * 10) / 10;
}

/** Build the 20-bin histogram plus cumulative and exceedance columns. */
export function histogram(values: readonly number[], binCount = DEFAULT_BIN_COUNT): Histogram {
  if (values.length === 0 || binCount < 1) {
    return { bins: [], more: 0, binSize: 0, mostLikelyRange: '' };
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const binSize = (hi - lo) / binCount;

  // Compute each edge from the origin rather than by accumulation, and pin the last
  // one to the sample maximum. Repeated addition drifts, and a final edge a few ulps
  // below the maximum silently tips that value into the `more` bucket.
  const edges: number[] = [];
  for (let i = 0; i <= binCount; i++) edges.push(lo + i * binSize);
  edges[binCount] = hi;

  const counts = new Array<number>(binCount).fill(0);
  let more = 0;
  for (const v of values) {
    // Upper-inclusive search: the first edge the value does not exceed.
    let placed = false;
    for (let i = 1; i <= binCount; i++) {
      if (v <= edges[i]!) {
        counts[i - 1] = counts[i - 1]! + 1;
        placed = true;
        break;
      }
    }
    if (!placed) more++;
  }

  const total = values.length;
  let running = 0;
  const bins: HistogramBin[] = counts.map((count, i) => {
    running += count;
    const cumulative = running / total;
    return {
      lower: edges[i]!,
      upper: edges[i + 1]!,
      label: `${round1(edges[i]!)} to ${round1(edges[i + 1]!)}`,
      count,
      cumulative,
      reverseCumulative: 1 - cumulative,
    };
  });

  let peak = bins[0]!;
  for (const bin of bins) if (bin.count > peak.count) peak = bin;

  return { bins, more, binSize, mostLikelyRange: peak.label };
}

/**
 * Empirical CDF as (value, probability) pairs at every realization - a smoother
 * exceedance curve than the 20-bin version, for charting.
 */
export function empiricalCdf(values: readonly number[]): { value: number; cumulative: number; exceedance: number }[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return sorted.map((value, i) => {
    const cumulative = (i + 1) / n;
    return { value, cumulative, exceedance: 1 - cumulative };
  });
}
