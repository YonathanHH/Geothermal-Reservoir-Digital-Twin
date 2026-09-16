/**
 * Operational thresholds and presets (Phase 4).
 *
 * Every number below is a heuristic operating default, not reservoir physics:
 * it encodes "what a prudent engineer would find noteworthy", documented next
 * to the rule that uses it. All are overridable through function arguments.
 */

/** Reservoir pressure at/below which production is deemed non-viable, bar. */
export const PRESSURE_FLOOR_BAR = 5;

/** Lookback window for decline-rate rules, in assimilation cycles. */
export const DECLINE_WINDOW_CYCLES = 5;

/**
 * Sustained pressure decline that earns a watch / warning, bar per year.
 * ~2 bar/yr is visible against typical posterior noise; 5 bar/yr threatens
 * the floor within a few years from normal operating pressures.
 */
export const PRESSURE_DECLINE_WATCH_BAR_YR = 2;
export const PRESSURE_DECLINE_WARNING_BAR_YR = 5;

/**
 * Sustained temperature decline that earns a watch / warning, °C per year.
 * The tank cools single-digit °C per decade at baseline rates, so 1 °C/yr
 * sustained is already unusual and 3 °C/yr indicates aggressive drawdown.
 */
export const TEMP_DECLINE_WATCH_C_YR = 1;
export const TEMP_DECLINE_WARNING_C_YR = 3;

/** Pressure margin above the floor that earns a watch / warning, bar. */
export const PRESSURE_MARGIN_WATCH_BAR = 10;
export const PRESSURE_MARGIN_WARNING_BAR = 5;

/** Share of non-ok readings in recent telemetry that earns a watch, fraction. */
export const GAP_FRACTION_WATCH = 0.15;

/** Innovation 2σ coverage below which the filter is flagged overconfident. */
export const COVERAGE_WATCH = 0.5;
