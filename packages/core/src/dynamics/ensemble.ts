/**
 * Ensemble runner: propagate Monte Carlo realizations through the 30-year
 * monthly simulation (Phase 1).
 *
 * Static parameters reuse the exact per-parameter streams of `runMonteCarlo`
 * (`mulberry32(seedFromString(`${seed}:${key}`))`), so at a given seed every
 * static column is bit-identical to the static run. Dynamic-only parameters
 * (`cTotal`, `recharge`) draw from their own additional streams under the same
 * convention, so fixing one of them never reshuffles the others. The static
 * engine itself is not called and not modified.
 */

import { sample } from '../distributions.js';
import { mulberry32, seedFromString } from '../rng.js';
import { DEFAULT_PARAMETERS, toResourceInputs } from '../model.js';
import { PARAMETER_KEYS, type ParameterKey, type ParameterSpec } from '../types.js';
import { initialDynamicState } from './init.js';
import { step } from './step.js';
import {
  DT_SECONDS,
  TOTAL_STEPS,
  controlsAt,
  defaultSchedule,
  type DynamicSchedule,
} from './schedule.js';
import {
  DEFAULT_DYNAMIC_PARAMETERS,
  DYNAMICS_VERSION,
} from './params.js';
import type { DynamicParameterKey, DynamicParameterSpec, ReservoirState } from './types.js';
import { MODEL_VERSION } from '../model.js';

export interface DynamicEnsembleConfig {
  /** Number of trajectories. */
  n?: number;
  /** 32-bit seed. The same seed always yields the same ensemble. */
  seed?: number;
  /** Static parameter table (defaults to the demonstration field). */
  parameters?: Record<ParameterKey, ParameterSpec>;
  /** Dynamic-only parameter table (compressibility + recharge). */
  dynamicParameters?: Record<DynamicParameterKey, DynamicParameterSpec>;
  /** Project lifetime is the V1 horizon; kept for provenance. */
  horizonYears?: number;
  /** Operating schedule (default: 80 kg/s produced, 56 kg/s injected at 60 degC). */
  schedule?: DynamicSchedule;
  /** Optional label recorded with the run. */
  label?: string;
}

export interface DynamicTrajectory {
  index: number;
  values: Record<ParameterKey, number>;
  dynamicValues: Record<DynamicParameterKey, number>;
  /** States at t = 0 .. TOTAL_STEPS (TOTAL_STEPS + 1 entries). */
  states: ReservoirState[];
}

export interface DynamicEnsemble {
  label: string;
  seed: number;
  n: number;
  modelVersion: string;
  dynamicsVersion: string;
  timestamp: string;
  parameters: Record<ParameterKey, ParameterSpec>;
  dynamicParameters: Record<DynamicParameterKey, DynamicParameterSpec>;
  schedule: DynamicSchedule;
  trajectories: DynamicTrajectory[];
  /** Final instantaneous capacity across trajectories, MWe. */
  finalCapacityMwe: number[];
  /** Final reservoir temperature across trajectories, degC. */
  finalTemperatureC: number[];
  /** Final reservoir pressure across trajectories, bar. */
  finalPressureBar: number[];
  /** Trajectories rejected on physical invalidity, with step and reason. */
  rejected: { index: number; step: number; reason: string }[];
}

/** Run the dynamic ensemble and return every trajectory. */
export interface SampledEnsembleColumns {
  staticColumns: Record<ParameterKey, number[]>;
  dynamicColumns: Record<DynamicParameterKey, number[]>;
}

/**
 * Draw parameter columns with one isolated stream per parameter —
 * `mulberry32(seedFromString(`${seed}:${key}`))`. Exported so the twin
 * experiment draws bit-identical columns for the same seed; the static
 * engine itself is not called and not modified.
 */
export function sampleEnsembleColumns(
  n: number,
  seed: number,
  parameters: Record<ParameterKey, ParameterSpec>,
  dynamicParameters: Record<DynamicParameterKey, DynamicParameterSpec>,
): SampledEnsembleColumns {
  // Static columns: identical streams to runMonteCarlo for the same seed.
  const staticColumns = {} as Record<ParameterKey, number[]>;
  for (const key of PARAMETER_KEYS) {
    const rng = mulberry32(seedFromString(`${seed}:${key}`));
    staticColumns[key] = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const spec = parameters[key];
      staticColumns[key][i] = sample(rng, spec.distribution, spec.mostLikely, spec.min, spec.max);
    }
  }
  // Dynamic-only columns: own streams under the same convention.
  const dynamicColumns = {} as Record<DynamicParameterKey, number[]>;
  for (const key of ['cTotal', 'recharge'] as const) {
    const rng = mulberry32(seedFromString(`${seed}:${key}`));
    dynamicColumns[key] = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const spec = dynamicParameters[key];
      dynamicColumns[key][i] = sample(rng, spec.distribution, spec.mostLikely, spec.min, spec.max);
    }
  }
  return { staticColumns, dynamicColumns };
}

/** Run the dynamic ensemble and return every trajectory. */
export function runDynamicEnsemble(config: DynamicEnsembleConfig = {}): DynamicEnsemble {
  const {
    n = 1000,
    seed = 42,
    parameters = DEFAULT_PARAMETERS,
    dynamicParameters = DEFAULT_DYNAMIC_PARAMETERS,
    horizonYears = 30,
    schedule = defaultSchedule(),
    label = 'Dynamic base case',
  } = config;

  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError(`runDynamicEnsemble: n must be an integer >= 2, got ${n}`);
  }

  const { staticColumns, dynamicColumns } = sampleEnsembleColumns(
    n,
    seed,
    parameters,
    dynamicParameters,
  );

  const trajectories: DynamicTrajectory[] = [];
  const rejected: DynamicEnsemble['rejected'] = [];
  const finalCapacityMwe: number[] = [];
  const finalTemperatureC: number[] = [];
  const finalPressureBar: number[] = [];

  for (let i = 0; i < n; i++) {
    const values = Object.fromEntries(
      PARAMETER_KEYS.map((key) => [key, staticColumns[key]![i]]),
    ) as Record<ParameterKey, number>;
    const dynamicValues = {
      cTotal: dynamicColumns.cTotal![i]!,
      recharge: dynamicColumns.recharge![i]!,
    };
    const states: ReservoirState[] = [];
    try {
      const inputs = toResourceInputs(values, horizonYears);
      const { state: initial, params } = initialDynamicState(inputs, {
        totalCompressibilityPerBar: dynamicValues.cTotal,
        rechargeKgS: dynamicValues.recharge,
      });
      states.push(initial);
      let current = initial;
      for (let s = 0; s < TOTAL_STEPS; s++) {
        const result = step(current, controlsAt(schedule, s), params, DT_SECONDS);
        current = result.state;
        states.push(current);
      }
      trajectories.push({ index: i, values, dynamicValues, states });
      finalCapacityMwe.push(current.capacityMweInstant);
      finalTemperatureC.push(current.temperatureC);
      finalPressureBar.push(current.pressureBar);
    } catch (error) {
      // states.length - 1 is the last completed step (0 when initialisation failed).
      rejected.push({ index: i, step: states.length - 1, reason: (error as Error).message });
    }
  }

  return {
    label,
    seed,
    n,
    modelVersion: MODEL_VERSION,
    dynamicsVersion: DYNAMICS_VERSION,
    timestamp: new Date().toISOString(),
    parameters,
    dynamicParameters,
    schedule,
    trajectories,
    finalCapacityMwe,
    finalTemperatureC,
    finalPressureBar,
    rejected,
  };
}
