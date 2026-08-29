/**
 * The baseline model configuration.
 *
 * These values describe a **synthetic demonstration field**. They are round numbers
 * chosen to sit in a plausible range for a liquid-dominated geothermal resource; they do
 * not describe any real asset and must not be presented as an assessment of one. Point
 * the model at real inputs by editing the parameter table in the dashboard, or by
 * passing your own `parameters` to `runMonteCarlo`.
 *
 * This is the only place the baseline numbers appear, so a scenario is always
 * expressible as a diff against it.
 */
import type { ParameterKey, ParameterSpec, ResourceInputs } from './types.js';
import { PARAMETER_KEYS } from './types.js';

/**
 * Model version, recorded on every run. Bump whenever a change alters numerical output,
 * so archived results stay interpretable.
 */
export const MODEL_VERSION = '0.2.0';

/** Name of the demonstration case, shown in the dashboard header. */
export const FIELD_NAME = 'Demo Field A (synthetic)';

/**
 * Baseline parameter specification.
 *
 * Six inputs carry uncertainty; four are `Fixed`. A `Fixed` parameter uses only its
 * most-likely value, so its `min` and `max` are held equal to it rather than left as
 * decorative values that never affect a result.
 */
export const DEFAULT_PARAMETERS: Record<ParameterKey, ParameterSpec> = {
  A: { key: 'A', label: 'Reservoir Area', unit: 'km2', min: 2, mostLikely: 4, max: 6, distribution: 'PERT', fractional: false },
  H: { key: 'H', label: 'Reservoir Thickness', unit: 'm', min: 300, mostLikely: 600, max: 900, distribution: 'PERT', fractional: false },
  T: { key: 'T', label: 'Reservoir Temperature', unit: 'degC', min: 160, mostLikely: 220, max: 280, distribution: 'PERT', fractional: false },
  R: { key: 'R', label: 'Recovery Factor', unit: '%', min: 0.05, mostLikely: 0.12, max: 0.2, distribution: 'PERT', fractional: true },
  u: { key: 'u', label: 'Utilization Factor', unit: '%', min: 0.3, mostLikely: 0.4, max: 0.5, distribution: 'PERT', fractional: true },
  fi: { key: 'fi', label: 'Porosity', unit: '%', min: 0.04, mostLikely: 0.1, max: 0.16, distribution: 'Uniform', fractional: true },
  CR: { key: 'CR', label: 'Specific Heat of Rock', unit: 'kJ/m3/degC', min: 2500, mostLikely: 2500, max: 2500, distribution: 'Fixed', fractional: false },
  D: { key: 'D', label: 'Average Reservoir Depth', unit: 'm', min: 500, mostLikely: 500, max: 500, distribution: 'Fixed', fractional: false },
  Ta: { key: 'Ta', label: 'Ambient Temperature', unit: 'degC', min: 20, mostLikely: 20, max: 20, distribution: 'Fixed', fractional: false },
  F: { key: 'F', label: 'Plant Capacity Factor', unit: '%', min: 0.9, mostLikely: 0.9, max: 0.9, distribution: 'Fixed', fractional: true },
};

/**
 * Project lifetime in years. Held outside the parameter table because it scales the
 * result rather than describing the resource: capacity is energy divided by project
 * life, so a longer project means a lower sustainable average capacity from the same
 * resource.
 */
export const DEFAULT_LIFETIME_YEARS = 30;

/** Map a sampled parameter set onto the named, unit-suffixed physics inputs. */
export function toResourceInputs(
  values: Record<ParameterKey, number>,
  lifetimeYears: number,
): ResourceInputs {
  return {
    areaKm2: values.A,
    thicknessM: values.H,
    temperatureC: values.T,
    recoveryFactor: values.R,
    utilizationFactor: values.u,
    porosity: values.fi,
    rockHeatCapacityKjM3C: values.CR,
    depthM: values.D,
    ambientTemperatureC: values.Ta,
    capacityFactor: values.F,
    lifetimeYears,
  };
}

/** The deterministic case: every input at its most-likely value. */
export function mostLikelyInputs(
  parameters: Record<ParameterKey, ParameterSpec> = DEFAULT_PARAMETERS,
  lifetimeYears: number = DEFAULT_LIFETIME_YEARS,
): ResourceInputs {
  const values = Object.fromEntries(
    PARAMETER_KEYS.map((key) => [key, parameters[key].mostLikely]),
  ) as Record<ParameterKey, number>;
  return toResourceInputs(values, lifetimeYears);
}

/** Deep copy of the baseline, safe to mutate in the UI. */
export function cloneParameters(
  parameters: Record<ParameterKey, ParameterSpec> = DEFAULT_PARAMETERS,
): Record<ParameterKey, ParameterSpec> {
  return Object.fromEntries(
    PARAMETER_KEYS.map((key) => [key, { ...parameters[key] }]),
  ) as Record<ParameterKey, ParameterSpec>;
}
