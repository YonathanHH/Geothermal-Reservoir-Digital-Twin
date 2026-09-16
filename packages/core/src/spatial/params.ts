/**
 * Spatial defaults and versioning (Phase 3).
 *
 * The four influence coefficients are effective reduced-order numbers, not
 * measured rock properties. Defaults are sized so a typical well (10–25 kg/s)
 * draws of order 1 bar on itself with sub-bar interference — small against
 * bulk pressures of tens of bar, large enough to read on a map. See
 * ASSUMPTIONS.md §14.
 */

import type { SpatialParams } from './types.js';

/** Version of the spatial module, recorded on every layout. */
export const SPATIAL_VERSION = '0.1.0';

/** Default producer/injector/observation well counts for the demo field. */
export const DEFAULT_WELL_COUNTS = {
  production: 4,
  injection: 3,
  observation: 1,
} as const;

/** Default influence coefficients (synthetic demonstration values). */
export const DEFAULT_SPATIAL_PARAMS: SpatialParams = {
  drawdownPerRate: 0.04,
  influenceLengthFrac: 0.6,
  coolingFraction: 0.15,
  thermalLengthFrac: 0.4,
};

/** Throw `RangeError` on any non-physical spatial parameter set. */
export function assertValidSpatialParams(params: SpatialParams): void {
  if (!Number.isFinite(params.drawdownPerRate) || params.drawdownPerRate < 0) {
    throw new RangeError(
      `spatial: drawdownPerRate must be >= 0, got ${params.drawdownPerRate}.`,
    );
  }
  for (const [name, value] of [
    ['influenceLengthFrac', params.influenceLengthFrac],
    ['coolingFraction', params.coolingFraction],
    ['thermalLengthFrac', params.thermalLengthFrac],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 2) {
      throw new RangeError(`spatial: ${name} must lie in (0, 2], got ${value}.`);
    }
  }
}
