/**
 * Simulation horizon and operating schedule (Phase 1).
 *
 * V1 horizon: 30 years at a 1-month timestep (360 steps). Controls are
 * prescribed production and injection rates; there is no pressure-target
 * controller yet. A schedule is a constant set of controls by default and an
 * explicit per-step array when the caller needs time variation — both flow
 * through the same pure `step`, so a schedule can never smuggle state.
 */

import type { Controls } from './types.js';
import {
  DEFAULT_INJECTION_KG_S,
  DEFAULT_INJECTION_TEMPERATURE_C,
  DEFAULT_PRODUCTION_KG_S,
} from './params.js';

/** Seconds in a year, using the same 365.25-day convention as `physics.ts`. */
export const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

/** Simulation horizon, years. */
export const HORIZON_YEARS = 30;

/** Timesteps per year (monthly). */
export const STEPS_PER_YEAR = 12;

/** Total number of steps in a V1 run. */
export const TOTAL_STEPS = HORIZON_YEARS * STEPS_PER_YEAR;

/** Timestep length, years. */
export const DT_YEARS = 1 / STEPS_PER_YEAR;

/** Timestep length, seconds. */
export const DT_SECONDS = DT_YEARS * SECONDS_PER_YEAR;

/** Constant operating schedule: the same controls every step. */
export interface ConstantSchedule {
  kind: 'constant';
  controls: Controls;
}

/** Time-varying operating schedule: exactly one entry per step. */
export interface StepwiseSchedule {
  kind: 'stepwise';
  steps: Controls[];
}

export type DynamicSchedule = ConstantSchedule | StepwiseSchedule;

/** Default V1 schedule: 80 kg/s produced, 56 kg/s injected at 60 degC. */
export function defaultSchedule(): ConstantSchedule {
  return {
    kind: 'constant',
    controls: {
      productionKgS: DEFAULT_PRODUCTION_KG_S,
      injectionKgS: DEFAULT_INJECTION_KG_S,
      injectionTemperatureC: DEFAULT_INJECTION_TEMPERATURE_C,
    },
  };
}

/** Controls applied at step `index` (0-based). Pure: no state, no mutation. */
export function controlsAt(schedule: DynamicSchedule, index: number): Controls {
  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_STEPS) {
    throw new RangeError(`controlsAt: index ${index} is outside [0, ${TOTAL_STEPS}).`);
  }
  if (schedule.kind === 'constant') return { ...schedule.controls };
  const entry = schedule.steps[index];
  if (!entry) throw new RangeError(`controlsAt: stepwise schedule is missing step ${index}.`);
  return { ...entry };
}

/** Build a constant schedule from explicit rates. All fields configurable. */
export function constantSchedule(
  productionKgS: number = DEFAULT_PRODUCTION_KG_S,
  injectionKgS: number = DEFAULT_INJECTION_KG_S,
  injectionTemperatureC: number = DEFAULT_INJECTION_TEMPERATURE_C,
): ConstantSchedule {
  return { kind: 'constant', controls: { productionKgS, injectionKgS, injectionTemperatureC } };
}

/** Build a stepwise schedule. Must hold exactly TOTAL_STEPS entries. */
export function stepwiseSchedule(steps: Controls[]): StepwiseSchedule {
  if (steps.length !== TOTAL_STEPS) {
    throw new RangeError(
      `stepwiseSchedule: expected ${TOTAL_STEPS} entries, got ${steps.length}.`,
    );
  }
  return { kind: 'stepwise', steps: steps.map((s) => ({ ...s })) };
}

/** Throw `RangeError` if controls are non-finite or negative. */
export function assertValidControls(controls: Controls): void {
  for (const field of ['productionKgS', 'injectionKgS', 'injectionTemperatureC'] as const) {
    const value = controls[field];
    if (!Number.isFinite(value)) {
      throw new RangeError(`controlsAt/step: ${field} must be finite, got ${value}.`);
    }
  }
  if (controls.productionKgS < 0) {
    throw new RangeError(`step: productionKgS cannot be negative, got ${controls.productionKgS}.`);
  }
  if (controls.injectionKgS < 0) {
    throw new RangeError(`step: injectionKgS cannot be negative, got ${controls.injectionKgS}.`);
  }
}
