/** Shared vocabulary for the volumetric model. */

/** The ten model inputs, in the order the sampler iterates them. */
export const PARAMETER_KEYS = ['A', 'H', 'T', 'R', 'u', 'fi', 'CR', 'D', 'Ta', 'F'] as const;
export type ParameterKey = (typeof PARAMETER_KEYS)[number];

/**
 * How an input's uncertainty is described.
 *
 * `PERT` is a Beta-PERT distribution defined by a three-point estimate - the standard
 * choice in resource assessment, where experts can state a plausible range and a
 * most-likely value but not a variance. `Fixed` inputs contribute no uncertainty.
 */
export type DistributionLabel = 'PERT' | 'Triangular' | 'Uniform' | 'Fixed';

export interface ParameterSpec {
  key: ParameterKey;
  /** Human-readable parameter name. */
  label: string;
  /** Physical unit of `min`, `mostLikely` and `max`. */
  unit: string;
  min: number;
  mostLikely: number;
  max: number;
  distribution: DistributionLabel;
  /**
   * True when the parameter is stored as a fraction but reported per percentage point
   * (R, u, fi, F), which is how its sensitivity slope is expressed.
   */
  fractional: boolean;
}

/** One realization's worth of model inputs, in the model's native units. */
export interface ResourceInputs {
  /** Reservoir area, km2. */
  areaKm2: number;
  /** Reservoir thickness, m. */
  thicknessM: number;
  /** Reservoir temperature, degC. */
  temperatureC: number;
  /** Recovery factor, fraction. */
  recoveryFactor: number;
  /** Utilization factor, fraction. */
  utilizationFactor: number;
  /** Porosity, fraction. */
  porosity: number;
  /** Volumetric heat capacity of rock, kJ/(m3.degC). */
  rockHeatCapacityKjM3C: number;
  /** Average reservoir depth, m. */
  depthM: number;
  /** Ambient (rejection) temperature, degC. */
  ambientTemperatureC: number;
  /** Plant capacity factor, fraction. */
  capacityFactor: number;
  /** Project lifetime, years. */
  lifetimeYears: number;
}

/** Every intermediate of the calculation chain, kept for diagnostics and validation. */
export interface ResourceResult {
  /** Combined rock + water volumetric heat capacity, kJ/(m3.degC). */
  ctKjM3C: number;
  /** Reservoir thermal energy in place, PJ. */
  qrPj: number;
  /** Thermal energy recovered at the wellhead, PJ. */
  qwhPj: number;
  /** Wellhead enthalpy, kJ/kg. */
  hwhKjKg: number;
  /** Ambient enthalpy, kJ/kg. */
  hoKjKg: number;
  /** Wellhead entropy, kJ/(kg.K). */
  swhKjKgK: number;
  /** Ambient entropy, kJ/(kg.K). */
  soKjKgK: number;
  /** Mass of fluid produced at the wellhead, Pg (1e12 kg). */
  mwhPg: number;
  /** Available (exergetic) work, PJ. */
  waPj: number;
  /** Electrical energy obtainable, PJ. */
  ePj: number;
  /** Average generation capacity over the project lifetime, MWe. */
  capacityMwe: number;
}
