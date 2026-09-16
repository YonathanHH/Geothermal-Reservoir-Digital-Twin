/**
 * Dynamic-only uncertain parameters and schedule defaults (Phase 1).
 *
 * The static ten-parameter table in `model.ts` is untouched. These two extra
 * parameters live in their own table with their own RNG streams so the static
 * Monte Carlo record is bit-identical and the static behaviour cannot change.
 */

import type { DynamicParameterSpec, DynamicParameterKey } from './types.js';

/** Version of the dynamics module, recorded on every ensemble run. */
export const DYNAMICS_VERSION = '0.1.0';

/** The dynamic-only uncertain parameters, in sampling order. */
export const DYNAMIC_PARAMETER_KEYS = ['cTotal', 'recharge'] as const;

/**
 * Baseline dynamic parameter specification (synthetic demonstration values).
 *
 * - `cTotal` is an effective pressure-storage parameter for the reduced-order
 *   tank, not a directly measured reservoir property. Pure liquid + pore
 *   compressibility would sit near 1e-4 /bar, but a closed tank with that value
 *   would lose hundreds of bar for a few percent of mass withdrawal. The V1
 *   range below is deliberately centred an order of magnitude higher so the
 *   baseline drawdown over 30 years is tens of bar: it stands in for fracture
 *   compliance and boundary support that the lumped tank does not resolve.
 *   The PERT shape keeps the most-likely value weighted as in the static
 *   framework.
 * - `recharge` is a small constant natural recharge. Its most-likely value
 *   (2 kg/s) is forty times smaller than the default production rate
 *   (80 kg/s), so the baseline field stays production/injection driven.
 */
export const DEFAULT_DYNAMIC_PARAMETERS: Record<DynamicParameterKey, DynamicParameterSpec> = {
  cTotal: {
    key: 'cTotal',
    label: 'Total Compressibility',
    unit: '1/bar',
    min: 2e-3,
    mostLikely: 8e-3,
    max: 3e-2,
    distribution: 'PERT',
  },
  recharge: {
    key: 'recharge',
    label: 'Natural Recharge Rate',
    unit: 'kg/s',
    min: 0.5,
    mostLikely: 2,
    max: 5,
    distribution: 'PERT',
  },
};

/** Default injection temperature, degC (V1 choice). */
export const DEFAULT_INJECTION_TEMPERATURE_C = 60;

/** Default prescribed production rate, kg/s. Explicit control, not derived. */
export const DEFAULT_PRODUCTION_KG_S = 80;

/** Default prescribed injection rate, kg/s (70% of production). */
export const DEFAULT_INJECTION_KG_S = 56;

/** Deep copy of the dynamic baseline, safe to mutate. */
export function cloneDynamicParameters(
  parameters: Record<DynamicParameterKey, DynamicParameterSpec> = DEFAULT_DYNAMIC_PARAMETERS,
): Record<DynamicParameterKey, DynamicParameterSpec> {
  return {
    cTotal: { ...parameters.cTotal },
    recharge: { ...parameters.recharge },
  };
}
