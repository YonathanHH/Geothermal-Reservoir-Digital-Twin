/**
 * Scenarios: named, reproducible deviations from the baseline configuration.
 *
 * A scenario is stored as a *diff*, not as a full parameter snapshot, so that a change
 * to the baseline propagates and the intent of the scenario ("half the recovery
 * factor", "50-year project") stays legible. The resolved snapshot is recorded on the
 * run itself, which is what makes an archived result reproducible.
 */
import { runMonteCarlo, type MonteCarloConfig, type MonteCarloRun } from './monteCarlo.js';
import { cloneParameters, DEFAULT_LIFETIME_YEARS, DEFAULT_PARAMETERS } from './model.js';
import { summarize, type SummaryStatistics } from './stats.js';
import { histogram, type Histogram } from './histogram.js';
import { sensitivity, type SensitivityEntry } from './sensitivity.js';
import { PARAMETER_KEYS, type ParameterKey, type ParameterSpec } from './types.js';

/** Fields of a parameter a scenario is allowed to override. */
export type ParameterOverride = Partial<Pick<ParameterSpec, 'min' | 'mostLikely' | 'max' | 'distribution'>>;

export interface Scenario {
  id: string;
  label: string;
  /** Free-text rationale, surfaced in the UI next to the results. */
  notes?: string;
  overrides: Partial<Record<ParameterKey, ParameterOverride>>;
  lifetimeYears?: number;
  seed?: number;
  n?: number;
}

export interface ScenarioResult {
  scenario: Scenario;
  run: MonteCarloRun;
  statistics: SummaryStatistics;
  histogram: Histogram;
  sensitivity: SensitivityEntry[];
}

/** Apply a scenario's overrides to a baseline parameter table. */
export function resolveParameters(
  scenario: Scenario,
  baseline: Record<ParameterKey, ParameterSpec> = DEFAULT_PARAMETERS,
): Record<ParameterKey, ParameterSpec> {
  const resolved = cloneParameters(baseline);
  for (const key of PARAMETER_KEYS) {
    const override = scenario.overrides[key];
    if (override) Object.assign(resolved[key], override);
  }
  return resolved;
}

/** Run a scenario end-to-end and return everything the dashboard needs to render it. */
export function runScenario(
  scenario: Scenario,
  config: Omit<MonteCarloConfig, 'parameters' | 'lifetimeYears' | 'label'> = {},
): ScenarioResult {
  const run = runMonteCarlo({
    ...config,
    n: scenario.n ?? config.n,
    seed: scenario.seed ?? config.seed,
    parameters: resolveParameters(scenario),
    lifetimeYears: scenario.lifetimeYears ?? DEFAULT_LIFETIME_YEARS,
    label: scenario.label,
  });

  return {
    scenario,
    run,
    statistics: summarize(run.capacityMwe),
    histogram: histogram(run.capacityMwe),
    sensitivity: sensitivity(run),
  };
}

export interface ScenarioComparisonRow {
  metric: string;
  unit: string;
  baseline: number;
  candidate: number;
  /** candidate - baseline. */
  delta: number;
  /** Relative change, or NaN when the baseline is zero. */
  relative: number;
}

/** Aligned metric-by-metric comparison of two scenario results. */
export function compareScenarios(baseline: ScenarioResult, candidate: ScenarioResult): ScenarioComparisonRow[] {
  const row = (metric: string, unit: string, a: number, b: number): ScenarioComparisonRow => ({
    metric,
    unit,
    baseline: a,
    candidate: b,
    delta: b - a,
    relative: a === 0 ? NaN : (b - a) / a,
  });

  const rows: ScenarioComparisonRow[] = [
    row('Mean', 'MWe', baseline.statistics.mean, candidate.statistics.mean),
    row('Median (P50)', 'MWe', baseline.statistics.median, candidate.statistics.median),
    row('Std. deviation', 'MWe', baseline.statistics.stdev, candidate.statistics.stdev),
    row('Minimum', 'MWe', baseline.statistics.min, candidate.statistics.min),
    row('Maximum', 'MWe', baseline.statistics.max, candidate.statistics.max),
  ];

  for (const level of [0.9, 0.5, 0.1] as const) {
    const find = (result: ScenarioResult) =>
      result.statistics.exceedance.find((e) => e.probability === level)?.value ?? NaN;
    rows.push(row(`P${Math.round(level * 100)}`, 'MWe', find(baseline), find(candidate)));
  }

  return rows;
}

/** A small set of illustrative scenarios, used to seed the dashboard's scenario lab. */
export const EXAMPLE_SCENARIOS: Scenario[] = [
  {
    id: 'base',
    label: 'Base case',
    notes: 'The baseline three-point estimates for the demonstration field.',
    overrides: {},
  },
  {
    id: 'conservative-recovery',
    label: 'Conservative recovery',
    notes: 'Recovery factor halved, reflecting poorer-than-expected reservoir connectivity.',
    overrides: { R: { min: 0.025, mostLikely: 0.06, max: 0.1 } },
  },
  {
    id: 'extended-life',
    label: '50-year project',
    notes: 'The same resource spread over a longer life, lowering average sustainable capacity.',
    overrides: {},
    lifetimeYears: 50,
  },
  {
    id: 'hotter-reservoir',
    label: 'Hotter reservoir',
    notes: 'Appraisal drilling confirms a hotter resource; temperature range shifted up 40 degC.',
    overrides: { T: { min: 200, mostLikely: 260, max: 320 } },
  },
];
