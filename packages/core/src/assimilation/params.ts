/**
 * Estimator defaults and versioning (Phase 2).
 *
 * Wellhead temperature and pressure are the assimilated channels: both observe
 * the state almost directly, so the observation operator stays linear and the
 * filter's behaviour stays auditable. Generation and rates are known
 * controls/diagnostics, not state — assimilating generation would fold the
 * same rate information back through a nonlinear operator for no gain.
 */

/** Version of the assimilation module, recorded on every twin run. */
export const ASSIMILATION_VERSION = '0.1.0';

/** Default steps between assimilation cycles (12 = yearly on a monthly grid). */
export const DEFAULT_ASSIMILATION_INTERVAL_STEPS = 12;

/**
 * Default intentional prior error for the validation experiment: every member
 * starts this many °C above its unbiased initial temperature (energy rebuilt
 * consistently). Large enough to dominate sampling spread, small enough to
 * stay liquid-dominated.
 */
export const DEFAULT_INITIAL_TEMPERATURE_BIAS_C = 15;
