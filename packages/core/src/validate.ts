/**
 * Input guards.
 *
 * Anything physically invalid throws here, before it can propagate a NaN through a
 * thousand realizations and surface as a plausible-looking but meaningless percentile.
 */
import { REGION1_MAX_C, REGION1_MIN_C } from './steam/index.js';
import type { ResourceInputs } from './types.js';

export class ModelInputError extends Error {
  readonly field: keyof ResourceInputs;
  constructor(field: keyof ResourceInputs, message: string) {
    super(`${String(field)}: ${message}`);
    this.name = 'ModelInputError';
    this.field = field;
  }
}

function requireFinite(inputs: ResourceInputs, field: keyof ResourceInputs): number {
  const value = inputs[field];
  if (!Number.isFinite(value)) throw new ModelInputError(field, `expected a finite number, got ${value}`);
  return value;
}

/** Throw `ModelInputError` if `inputs` fall outside the model's domain of validity. */
export function assertValidInputs(inputs: ResourceInputs): void {
  if (requireFinite(inputs, 'areaKm2') <= 0)
    throw new ModelInputError('areaKm2', 'reservoir area must be positive');
  if (requireFinite(inputs, 'thicknessM') <= 0)
    throw new ModelInputError('thicknessM', 'reservoir thickness must be positive');

  const t = requireFinite(inputs, 'temperatureC');
  if (t <= REGION1_MIN_C || t >= REGION1_MAX_C)
    throw new ModelInputError(
      'temperatureC',
      `reservoir temperature must lie in the IF97 Region 1 liquid domain (${REGION1_MIN_C} < T < ${REGION1_MAX_C} degC)`,
    );

  const ta = requireFinite(inputs, 'ambientTemperatureC');
  if (ta <= REGION1_MIN_C || ta >= REGION1_MAX_C)
    throw new ModelInputError(
      'ambientTemperatureC',
      `ambient temperature must lie in (${REGION1_MIN_C}, ${REGION1_MAX_C}) degC`,
    );
  if (ta >= t)
    throw new ModelInputError('ambientTemperatureC', 'ambient temperature must be below reservoir temperature');

  const r = requireFinite(inputs, 'recoveryFactor');
  if (r <= 0 || r > 1) throw new ModelInputError('recoveryFactor', 'recovery factor must lie in (0, 1]');

  const u = requireFinite(inputs, 'utilizationFactor');
  if (u <= 0 || u > 1) throw new ModelInputError('utilizationFactor', 'utilization factor must lie in (0, 1]');

  const phi = requireFinite(inputs, 'porosity');
  if (phi < 0 || phi >= 1) throw new ModelInputError('porosity', 'porosity must lie in [0, 1)');

  if (requireFinite(inputs, 'rockHeatCapacityKjM3C') <= 0)
    throw new ModelInputError('rockHeatCapacityKjM3C', 'rock heat capacity must be positive');
  if (requireFinite(inputs, 'depthM') < 0)
    throw new ModelInputError('depthM', 'reservoir depth cannot be negative');

  const f = requireFinite(inputs, 'capacityFactor');
  if (f <= 0 || f > 1) throw new ModelInputError('capacityFactor', 'plant capacity factor must lie in (0, 1]');

  if (requireFinite(inputs, 'lifetimeYears') <= 0)
    throw new ModelInputError('lifetimeYears', 'project lifetime must be positive');
}
