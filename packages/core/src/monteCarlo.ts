/**
 * The Monte Carlo uncertainty engine.
 *
 * Each parameter draws from **its own** generator, seeded from the run seed combined
 * with the parameter's name. This matters more than it looks: with a single shared
 * stream, changing one input - even just fixing it, which consumes no draws - shifts
 * every subsequent parameter's numbers, so a scenario comparison would mix the effect of
 * the change with the effect of a reshuffled random stream. Per-parameter streams mean
 * that at a given seed, an untouched parameter draws exactly the same values no matter
 * what else was edited.
 *
 * Every realization keeps both its sampled inputs and its full output chain. Storing
 * only the final capacity would make it impossible to explain *why* a realization is an
 * outlier, which is the whole point of a traceable model.
 */
import { calculateResource } from './physics.js';
import { sample } from './distributions.js';
import { mulberry32, seedFromString, type Rng } from './rng.js';
import { DEFAULT_LIFETIME_YEARS, DEFAULT_PARAMETERS, MODEL_VERSION, toResourceInputs } from './model.js';
import { PARAMETER_KEYS, type ParameterKey, type ParameterSpec, type ResourceInputs, type ResourceResult } from './types.js';

export interface MonteCarloConfig {
  /** Number of realizations. */
  n?: number;
  /** 32-bit seed. The same seed always yields the same run. */
  seed?: number;
  parameters?: Record<ParameterKey, ParameterSpec>;
  lifetimeYears?: number;
  /** Optional label recorded with the run. */
  label?: string;
}

export interface Realization {
  index: number;
  values: Record<ParameterKey, number>;
  inputs: ResourceInputs;
  outputs: ResourceResult;
}

export interface MonteCarloRun {
  runId: string;
  label: string;
  seed: number;
  n: number;
  modelVersion: string;
  timestamp: string;
  lifetimeYears: number;
  parameters: Record<ParameterKey, ParameterSpec>;
  realizations: Realization[];
  /** Generation capacity for every realization, MWe - the primary result series. */
  capacityMwe: number[];
  /** Realizations rejected because the sampled inputs were physically invalid. */
  rejected: { index: number; values: Record<ParameterKey, number>; reason: string }[];
}

/** Draw `n` values for one parameter. */
function sampleColumn(rng: Rng, spec: ParameterSpec, n: number): number[] {
  const column = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    column[i] = sample(rng, spec.distribution, spec.mostLikely, spec.min, spec.max);
  }
  return column;
}

/** Run the probabilistic assessment and return the full simulation record. */
export function runMonteCarlo(config: MonteCarloConfig = {}): MonteCarloRun {
  const {
    n = 1000,
    seed = 42,
    parameters = DEFAULT_PARAMETERS,
    lifetimeYears = DEFAULT_LIFETIME_YEARS,
    label = 'Base case',
  } = config;

  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError(`runMonteCarlo: n must be an integer >= 2, got ${n}`);
  }

  const columns = {} as Record<ParameterKey, number[]>;
  for (const key of PARAMETER_KEYS) {
    const rng = mulberry32(seedFromString(`${seed}:${key}`));
    columns[key] = sampleColumn(rng, parameters[key], n);
  }

  const realizations: Realization[] = [];
  const rejected: MonteCarloRun['rejected'] = [];
  const capacityMwe: number[] = [];

  for (let i = 0; i < n; i++) {
    const values = Object.fromEntries(
      PARAMETER_KEYS.map((key) => [key, columns[key][i]!]),
    ) as Record<ParameterKey, number>;
    const inputs = toResourceInputs(values, lifetimeYears);
    try {
      const outputs = calculateResource(inputs);
      realizations.push({ index: i, values, inputs, outputs });
      capacityMwe.push(outputs.capacityMwe);
    } catch (error) {
      rejected.push({ index: i, values, reason: (error as Error).message });
    }
  }

  return {
    runId: `${seed}-${n}-v${MODEL_VERSION}`,
    label,
    seed,
    n,
    modelVersion: MODEL_VERSION,
    timestamp: new Date().toISOString(),
    lifetimeYears,
    parameters,
    realizations,
    capacityMwe,
    rejected,
  };
}

/** Extract one sampled input series across all realizations, for sensitivity analysis. */
export function inputSeries(run: MonteCarloRun, key: ParameterKey): number[] {
  return run.realizations.map((r) => r.values[key]);
}

/** Extract one output series across all realizations. */
export function outputSeries(run: MonteCarloRun, key: keyof ResourceResult): number[] {
  return run.realizations.map((r) => r.outputs[key]);
}
