/**
 * Remaining-capacity outlook from a scenario forecast (Phase 4).
 *
 * All indicators are read off recorded forecast states: years until pressure
 * first touches the operating floor, end-state conditions, time-integrated
 * generation, and the lowest generation seen. Deterministic consequences of
 * the forecast — no extrapolation beyond what `step()` produced.
 */

import { DT_SECONDS, STEPS_PER_YEAR } from '../dynamics/schedule.js';
import { PRESSURE_FLOOR_BAR } from './params.js';
import type { ForecastResult, ScenarioOutlook } from './types.js';

/** GWh from a capacity series: Σ MWe × dt(hours) / 1000. */
function cumulativeGWh(capacitiesMWe: number[]): number {
  const dtHours = DT_SECONDS / 3600;
  return capacitiesMWe.reduce((sum, mw) => sum + (mw * dtHours) / 1000, 0);
}

/** Summarize one scenario forecast against the operating floor. */
export function summarizeOutlook(scenarioId: string, forecast: ForecastResult): ScenarioOutlook {
  const states = forecast.states;
  const last = states[states.length - 1]!;
  let yearsToPressureFloor: number | null = null;
  for (let i = 0; i < states.length; i++) {
    if (states[i]!.pressureBar <= PRESSURE_FLOOR_BAR) {
      yearsToPressureFloor = i / STEPS_PER_YEAR;
      break;
    }
  }
  const generations = states.map((s) => s.capacityMweInstant);
  return {
    scenarioId,
    yearsToPressureFloor,
    endTemperatureC: last.temperatureC,
    endPressureBar: last.pressureBar,
    endGenerationMWe: last.capacityMweInstant,
    cumulativeGenerationGWh: cumulativeGWh(generations),
    minGenerationMWe: Math.min(...generations),
    truncated: forecast.truncated,
  };
}
