/**
 * Shared vocabulary for operational forecasting (Phase 4).
 *
 * Everything here composes existing deterministic tools: forecasts are pure
 * `step()` loops branching from an estimated state, scenarios resolve to the
 * existing stepwise schedules, and alerts/outlook are arithmetic over recorded
 * outputs. No new physics, no estimation, no language models.
 */

import type { ReservoirState } from '../dynamics/types.js';

/** Version of the operations module, recorded on every forecast run. */
export const OPERATIONS_VERSION = '0.1.0';

/** A forecast trajectory branching from a known state. */
export interface ForecastResult {
  /** States including the branch point; truncated early on depletion. */
  states: ReservoirState[];
  /** True when depletion stopped the forecast before nSteps. */
  truncated: boolean;
  /** Machine-readable stop reason when truncated. */
  stopReason: string | null;
  /** Absolute step index the forecast branched from. */
  startStep: number;
}

/** One ensemble member forecast. */
export interface EnsembleMemberForecast {
  index: number;
  states: ReservoirState[];
  truncated: boolean;
}

/** Uncertainty bands + deterministic branch for one scenario. */
export interface ScenarioForecast {
  scenarioId: string;
  /** Deterministic branch from the estimated state with most-likely params. */
  deterministic: ForecastResult;
  members: EnsembleMemberForecast[];
  rejected: number;
}

/** An operating scenario: rate multipliers over current operating rates. */
export interface OperationsScenario {
  id: string;
  label: string;
  notes: string;
  /** Multiplier on the current production rate (1 = unchanged). */
  productionScale: number;
  /** Multiplier on the current injection rate (1 = unchanged). */
  injectionScale: number;
}

/** Severity ladder: info < watch < warning. Never silent failures. */
export type AlertSeverity = 'info' | 'watch' | 'warning';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

/** Remaining-capacity outlook computed from one scenario forecast. */
export interface ScenarioOutlook {
  scenarioId: string;
  /** Years from branch point until pressure first reaches the floor (null = beyond horizon). */
  yearsToPressureFloor: number | null;
  endTemperatureC: number;
  endPressureBar: number;
  endGenerationMWe: number;
  /** Time-integrated generation over the forecast, GWh. */
  cumulativeGenerationGWh: number;
  /** Lowest instantaneous generation seen, MWe. */
  minGenerationMWe: number;
  truncated: boolean;
}
