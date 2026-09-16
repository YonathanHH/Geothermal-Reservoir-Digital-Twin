/**
 * Operating scenarios as diffs over current rates (Phase 4).
 *
 * A scenario never restates the whole schedule: it scales the operating point
 * in force at the branch step, so the intent ("produce 25% harder from here")
 * stays legible and a baseline change propagates. Resolution produces the
 * existing stepwise schedule type, so the dashboard's scenario lab pattern —
 * diffs, not snapshots — carries over unchanged.
 */

import {
  TOTAL_STEPS,
  controlsAt,
  stepwiseSchedule,
  type DynamicSchedule,
} from '../dynamics/schedule.js';
import type { OperationsScenario } from './types.js';

/** Built-in what-if presets; custom scenarios supply their own rates. */
export const OPERATIONS_SCENARIOS: OperationsScenario[] = [
  {
    id: 'baseline',
    label: 'Baseline (hold rates)',
    notes: 'Continue current production and injection unchanged.',
    productionScale: 1,
    injectionScale: 1,
  },
  {
    id: 'high-production',
    label: 'Increased production (+25%)',
    notes: 'Produce harder at unchanged injection; tests drawdown response.',
    productionScale: 1.25,
    injectionScale: 1,
  },
  {
    id: 'high-injection',
    label: 'Increased injection (+50%)',
    notes: 'Return more fluid; tests pressure support and cooling.',
    productionScale: 1,
    injectionScale: 1.5,
  },
  {
    id: 'low-production',
    label: 'Reduced production (−25%)',
    notes: 'Ease off production; tests recovery headroom.',
    productionScale: 0.75,
    injectionScale: 1,
  },
];

/** A fully custom operating point: absolute rates from the branch step on. */
export interface CustomRates {
  productionKgS: number;
  injectionKgS: number;
}

function assertScales(productionScale: number, injectionScale: number): void {
  for (const [name, value] of [
    ['productionScale', productionScale],
    ['injectionScale', injectionScale],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 4) {
      throw new RangeError(`operations: ${name} must lie in [0, 4], got ${value}.`);
    }
  }
}

/**
 * Resolve a scenario to a full-horizon stepwise schedule: baseline controls
 * before `startStep`, scaled (or custom) rates from `startStep` on. Pure.
 */
export function resolveOperationsSchedule(
  base: DynamicSchedule,
  scenario: OperationsScenario | CustomRates,
  startStep: number,
): DynamicSchedule {
  if (!Number.isInteger(startStep) || startStep < 0 || startStep > TOTAL_STEPS) {
    throw new RangeError(`operations: startStep must lie in [0, ${TOTAL_STEPS}], got ${startStep}.`);
  }
  const anchor = controlsAt(base, Math.min(startStep, TOTAL_STEPS - 1));
  const scaled: CustomRates =
    'productionScale' in scenario
      ? (() => {
          assertScales(scenario.productionScale, scenario.injectionScale);
          return {
            productionKgS: anchor.productionKgS * scenario.productionScale,
            injectionKgS: anchor.injectionKgS * scenario.injectionScale,
          };
        })()
      : scenario;
  if (
    !Number.isFinite(scaled.productionKgS) ||
    scaled.productionKgS < 0 ||
    !Number.isFinite(scaled.injectionKgS) ||
    scaled.injectionKgS < 0
  ) {
    throw new RangeError(
      `operations: custom rates must be finite and >= 0, got ${scaled.productionKgS}/${scaled.injectionKgS}.`,
    );
  }
  const steps = Array.from({ length: TOTAL_STEPS }, (_, s) => {
    if (s < startStep) return { ...controlsAt(base, s) };
    const previous = controlsAt(base, Math.min(s, TOTAL_STEPS - 1));
    return {
      productionKgS: scaled.productionKgS,
      injectionKgS: scaled.injectionKgS,
      injectionTemperatureC: previous.injectionTemperatureC,
    };
  });
  return stepwiseSchedule(steps);
}
