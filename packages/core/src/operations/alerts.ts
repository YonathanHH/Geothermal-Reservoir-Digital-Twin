/**
 * Deterministic operational alerts (Phase 4).
 *
 * No models, no language, no thresholds learned from data: each rule compares
 * a recorded quantity against a documented heuristic default and reports a
 * severity. Rules read twin cycles (estimation health), recent telemetry
 * quality (sensor health) and scenario forecasts (forward-looking risk), so
 * the three panel groups of the Operations view each have a quantitative
 * backing. All thresholds overridable; silence is never an output — an empty
 * rule returns no alert, and every alert names its inputs.
 */

import type { TwinCycle } from '../assimilation/types.js';
import type { ChannelDiagnostics } from '../telemetry/types.js';
import { STEPS_PER_YEAR } from '../dynamics/schedule.js';
import {
  COVERAGE_WATCH,
  DECLINE_WINDOW_CYCLES,
  GAP_FRACTION_WATCH,
  PRESSURE_DECLINE_WARNING_BAR_YR,
  PRESSURE_DECLINE_WATCH_BAR_YR,
  PRESSURE_FLOOR_BAR,
  PRESSURE_MARGIN_WARNING_BAR,
  PRESSURE_MARGIN_WATCH_BAR,
  TEMP_DECLINE_WARNING_C_YR,
  TEMP_DECLINE_WATCH_C_YR,
} from './params.js';
import type { Alert, ForecastResult } from './types.js';

export interface AlertThresholds {
  pressureDeclineWatch: number;
  pressureDeclineWarning: number;
  tempDeclineWatch: number;
  tempDeclineWarning: number;
  pressureMarginWatch: number;
  pressureMarginWarning: number;
  gapFractionWatch: number;
  coverageWatch: number;
  declineWindowCycles: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  pressureDeclineWatch: PRESSURE_DECLINE_WATCH_BAR_YR,
  pressureDeclineWarning: PRESSURE_DECLINE_WARNING_BAR_YR,
  tempDeclineWatch: TEMP_DECLINE_WATCH_C_YR,
  tempDeclineWarning: TEMP_DECLINE_WARNING_C_YR,
  pressureMarginWatch: PRESSURE_MARGIN_WATCH_BAR,
  pressureMarginWarning: PRESSURE_MARGIN_WARNING_BAR,
  gapFractionWatch: GAP_FRACTION_WATCH,
  coverageWatch: COVERAGE_WATCH,
  declineWindowCycles: DECLINE_WINDOW_CYCLES,
};

/** Least-squares slope per year over the trailing window of a series. */
function trailingSlopePerYear(values: number[], timesYears: number[], window: number): number | null {
  const n = Math.min(window, values.length);
  if (n < 2) return null;
  const xs = timesYears.slice(-n);
  const ys = values.slice(-n);
  if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) return null;
  return sxy / sxx;
}

export interface AlertInputs {
  /** Twin cycles, oldest first; posterior means are the assessed history. */
  cycles: TwinCycle[];
  /** Telemetry channel diagnostics for the observed window. */
  telemetry: ChannelDiagnostics[];
  /** Baseline scenario forecast (for forward-looking risk). */
  forecast: ForecastResult;
  thresholds?: Partial<AlertThresholds>;
}

/** Evaluate every rule; returns alerts ordered warning → watch → info. */
export function evaluateAlerts(input: AlertInputs): Alert[] {
  const thresholds: AlertThresholds = { ...DEFAULT_ALERT_THRESHOLDS, ...input.thresholds };
  const alerts: Alert[] = [];
  const { cycles } = input;
  if (cycles.length === 0) return alerts;
  const times = cycles.map((c) => c.timeYears);

  // 1. Sustained pressure decline in the posterior mean.
  const pSlope = trailingSlopePerYear(
    cycles.map((c) => c.postMeanP),
    times,
    thresholds.declineWindowCycles,
  );
  if (pSlope !== null && pSlope < 0) {
    const rate = -pSlope;
    if (rate >= thresholds.pressureDeclineWarning) {
      alerts.push({
        id: 'pressure-decline',
        severity: 'warning',
        title: 'Rapid pressure decline',
        detail: `Posterior pressure falling ${rate.toFixed(1)} bar/yr over the last ${thresholds.declineWindowCycles} cycles (warning at ${thresholds.pressureDeclineWarning}).`,
      });
    } else if (rate >= thresholds.pressureDeclineWatch) {
      alerts.push({
        id: 'pressure-decline',
        severity: 'watch',
        title: 'Sustained pressure decline',
        detail: `Posterior pressure falling ${rate.toFixed(1)} bar/yr over the last ${thresholds.declineWindowCycles} cycles (watch at ${thresholds.pressureDeclineWatch}).`,
      });
    }
  }

  // 2. Sustained thermal decline in the posterior mean.
  const tSlope = trailingSlopePerYear(
    cycles.map((c) => c.postMeanT),
    times,
    thresholds.declineWindowCycles,
  );
  if (tSlope !== null && tSlope < 0) {
    const rate = -tSlope;
    if (rate >= thresholds.tempDeclineWarning) {
      alerts.push({
        id: 'thermal-decline',
        severity: 'warning',
        title: 'Rapid thermal decline',
        detail: `Posterior temperature falling ${rate.toFixed(1)} °C/yr over the last ${thresholds.declineWindowCycles} cycles (warning at ${thresholds.tempDeclineWarning}).`,
      });
    } else if (rate >= thresholds.tempDeclineWatch) {
      alerts.push({
        id: 'thermal-decline',
        severity: 'watch',
        title: 'Sustained thermal decline',
        detail: `Posterior temperature falling ${rate.toFixed(1)} °C/yr over the last ${thresholds.declineWindowCycles} cycles (watch at ${thresholds.tempDeclineWatch}).`,
      });
    }
  }

  // 3. Proximity of the latest posterior pressure to the operating floor.
  const latestP = cycles[cycles.length - 1]!.postMeanP;
  if (Number.isFinite(latestP)) {
    const margin = latestP - PRESSURE_FLOOR_BAR;
    if (margin <= thresholds.pressureMarginWarning) {
      alerts.push({
        id: 'pressure-floor',
        severity: 'warning',
        title: 'Pressure near operating floor',
        detail: `Posterior pressure ${latestP.toFixed(1)} bar is within ${thresholds.pressureMarginWarning} bar of the ${PRESSURE_FLOOR_BAR} bar floor.`,
      });
    } else if (margin <= thresholds.pressureMarginWatch) {
      alerts.push({
        id: 'pressure-floor',
        severity: 'watch',
        title: 'Pressure approaching operating floor',
        detail: `Posterior pressure ${latestP.toFixed(1)} bar is within ${thresholds.pressureMarginWatch} bar of the ${PRESSURE_FLOOR_BAR} bar floor.`,
      });
    }
  }

  // 4. Observation gaps: share of non-ok readings across channels.
  let total = 0;
  let bad = 0;
  for (const d of input.telemetry) {
    total += d.n;
    bad += d.nMissing + d.nRejected;
  }
  if (total > 0 && bad / total >= thresholds.gapFractionWatch) {
    alerts.push({
      id: 'observation-gaps',
      severity: 'watch',
      title: 'Elevated observation gaps',
      detail: `${((bad / total) * 100).toFixed(1)}% of recent readings missing or rejected (watch at ${(thresholds.gapFractionWatch * 100).toFixed(0)}%). Estimation leans on fewer updates.`,
    });
  }

  // 5. Innovation coverage: low in-envelope share means overconfidence.
  const covered = cycles.filter(
    (c) => c.innovT !== null && c.innovStdT !== null && c.innovStdT > 0,
  );
  if (covered.length >= 5) {
    const inside = covered.filter((c) => Math.abs(c.innovT!) <= 2 * c.innovStdT!).length;
    const fraction = inside / covered.length;
    if (fraction < thresholds.coverageWatch) {
      alerts.push({
        id: 'filter-confidence',
        severity: 'watch',
        title: 'Filter may be overconfident',
        detail: `Only ${(fraction * 100).toFixed(0)}% of temperature innovations fall inside ±2σ (watch below ${(thresholds.coverageWatch * 100).toFixed(0)}%). Treat spread as a lower bound.`,
      });
    }
  }

  // 6. Forward-looking: baseline forecast dies before the horizon.
  if (input.forecast.truncated) {
    const reachedYears = (input.forecast.states.length - 1) / STEPS_PER_YEAR;
    alerts.push({
      id: 'forecast-exhaustion',
      severity: 'warning',
      title: 'Baseline forecast exhausts the tank',
      detail: `At current rates the forecast stops after ${reachedYears.toFixed(1)} years: ${input.forecast.stopReason ?? 'depletion'}.`,
    });
  }

  const order = { warning: 0, watch: 1, info: 2 } as const;
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
