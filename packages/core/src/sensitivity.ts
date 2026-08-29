/**
 * Sensitivity analysis: which inputs drive the spread in generation capacity.
 *
 * The method is deliberately simple - Pearson correlation and ordinary least-squares
 * slope of capacity against each sampled input. `Fixed` inputs are reported as zero:
 * they have no variance, so the statistic is undefined rather than zero, but zero is the
 * honest summary of their contribution.
 *
 * Two reporting conventions:
 *  - slopes for fraction-valued inputs (R, u, fi, F) are divided by 100, so the unit
 *    reads MWe per percentage point rather than MWe per unit fraction;
 *  - "normalised correlation" divides each correlation by the *sum* of all of them, so
 *    the column sums to 1 and reads as a contribution share.
 *
 * A caveat worth knowing: Pearson correlation assumes linearity. Capacity is exactly
 * linear in area, thickness, recovery and utilization, so the statistic is well founded
 * there. It is not linear in temperature - which enters through the steam properties,
 * the temperature difference and the enthalpy drop - or in porosity, so those
 * correlations understate a genuinely nonlinear influence. Spearman rank correlation is
 * computed alongside as a clearly labelled alternative, never mixed into the same column.
 */
import { correl, slope, spearman } from './stats.js';
import { inputSeries, type MonteCarloRun } from './monteCarlo.js';
import { PARAMETER_KEYS, type ParameterKey } from './types.js';

export interface SensitivityEntry {
  key: ParameterKey;
  label: string;
  unit: string;
  /** Pearson correlation with generation capacity; 0 for `Fixed` inputs. */
  correlation: number;
  /** `correlation / sum(correlations)`, so the column reads as a contribution share. */
  normalizedCorrelation: number;
  /** OLS slope, MWe per unit of this input (per percentage point where fractional). */
  slope: number;
  /** Unit string for the slope, e.g. "MWe/km2". */
  slopeUnit: string;
  /** Spearman rank correlation. Reported separately from the Pearson column. */
  spearman: number;
  /** False when the parameter is `Fixed`, i.e. contributes no uncertainty. */
  varies: boolean;
}

/** Compute the sensitivity table for a completed run. */
export function sensitivity(run: MonteCarloRun): SensitivityEntry[] {
  const capacity = run.capacityMwe;
  const capacityUnit = 'MWe';

  const raw = PARAMETER_KEYS.map((key) => {
    const spec = run.parameters[key];
    const varies = spec.distribution !== 'Fixed';
    const xs = inputSeries(run, key);
    const divisor = spec.fractional ? 100 : 1;
    return {
      key,
      label: spec.label,
      unit: spec.unit,
      correlation: varies ? correl(capacity, xs) : 0,
      slope: varies ? slope(capacity, xs) / divisor : 0,
      slopeUnit: `${capacityUnit}/${spec.unit}`,
      spearman: varies ? spearman(capacity, xs) : 0,
      varies,
    };
  });

  const total = raw.reduce((sum, entry) => sum + entry.correlation, 0);
  return raw.map((entry) => ({
    ...entry,
    normalizedCorrelation: total === 0 ? 0 : entry.correlation / total,
  }));
}

/** Sensitivity entries ordered for a tornado chart: strongest influence first. */
export function tornadoOrder(entries: SensitivityEntry[]): SensitivityEntry[] {
  return [...entries]
    .filter((entry) => entry.varies)
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}
