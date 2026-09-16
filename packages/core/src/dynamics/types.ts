/**
 * Shared vocabulary for the reduced-order dynamic tank model (Phase 1).
 *
 * This is a reduced-order synthetic reservoir model, not a high-fidelity
 * reservoir simulator. The tank is a single well-mixed block whose temperature,
 * pressure, fluid mass and stored thermal energy evolve under prescribed
 * production, injection and natural recharge. See `step.ts` for the equations
 * and `docs/ASSUMPTIONS.md` for what they do and do not represent.
 *
 * Conventions follow the static model: temperatures in degC, pressures in bar,
 * enthalpies in kJ/kg, thermal energy in PJ, fluid mass in kg (rates in kg/s).
 * The static chain carries mass in Pg; the dynamics carry mass in kg so that a
 * monthly mass flux (`~1e7 kg`) stays near unity and round-off stays small.
 * The conversion is exact: 1 Pg = 1e12 kg, and 1 Pg x 1 kJ/kg = 1 PJ.
 */

import type { DistributionLabel } from '../types.js';

/**
 * Specific-enthalpy provider.
 *
 * V1 uses saturated-liquid enthalpy `hL(T)` and ignores pressure. The optional
 * `pressureBar` argument exists so a pressure-dependent `hPT(p, T)` provider can
 * be supplied later without redesigning the dynamics API.
 */
export type EnthalpyProvider = (temperatureC: number, pressureBar?: number) => number;

/** Time-varying reservoir state, recorded at the start of each timestep. */
export interface ReservoirState {
  /** Elapsed simulation time, years. */
  timeYears: number;
  /** Bulk reservoir temperature, degC. */
  temperatureC: number;
  /** Reservoir pressure, bar. Explicit state in V1 (compressible-tank response). */
  pressureBar: number;
  /** Pore-fluid mass in place, kg. */
  fluidMassKg: number;
  /** Stored thermal energy relative to the ambient sink, PJ. */
  thermalEnergyPj: number;
  /** Cumulative produced mass since t = 0, kg. */
  cumulativeProducedKg: number;
  /** Cumulative injected mass since t = 0, kg. */
  cumulativeInjectedKg: number;
  /** Instantaneous nameplate-equivalent capacity at this state and rate, MWe. */
  capacityMweInstant: number;
}

/** Operating controls applied over one timestep. V1: prescribed rates only. */
export interface Controls {
  /** Produced mass rate, kg/s. Independent operating control (not derived). */
  productionKgS: number;
  /** Injected mass rate, kg/s. */
  injectionKgS: number;
  /** Injection fluid temperature, degC. Default 60. */
  injectionTemperatureC: number;
}

/**
 * Time-invariant parameters of one dynamic realization.
 *
 * Geometry and rock properties come from the static `ResourceInputs`; storage
 * and recharge below are dynamic-only uncertain parameters sampled in the
 * ensemble rather than fixed.
 */
export interface DynamicParams {
  /** Bulk reservoir volume, m3. */
  volumeM3: number;
  /** Pore volume (volumeM3 x porosity), m3. */
  poreVolumeM3: number;
  /** Porosity, fraction. */
  porosity: number;
  /** Volumetric heat capacity of rock, kJ/(m3.degC). */
  rockHeatCapacityKjM3C: number;
  /** Average reservoir depth, m (wellbore head term). */
  depthM: number;
  /** Ambient (rejection) temperature, degC. */
  ambientTemperatureC: number;
  /** Plant capacity factor, fraction. */
  capacityFactor: number;
  /** Utilization factor, fraction. */
  utilizationFactor: number;
  /**
   * Total (fluid + formation) compressibility, 1/bar.
   *
   * Reduced-order pressure-storage parameter, NOT a directly measured reservoir
   * property. It sets how far pressure moves per unit of net mass change.
   */
  totalCompressibilityPerBar: number;
  /** Natural recharge rate, kg/s. Small constant; sampled, not fixed. */
  rechargeKgS: number;
  /** Enthalpy carried per kg of recharge, kJ/kg. V1: saturated liquid at T. */
  rechargeEnthalpyKjKg?: number;
}

/** Key for a dynamic-only uncertain parameter. */
export type DynamicParameterKey = 'cTotal' | 'recharge';

export interface DynamicParameterSpec {
  key: DynamicParameterKey;
  /** Human-readable parameter name. */
  label: string;
  /** Physical unit of `min`, `mostLikely` and `max`. */
  unit: string;
  min: number;
  mostLikely: number;
  max: number;
  distribution: DistributionLabel;
}

/** Per-step diagnostics, kept so a trajectory can be audited step by step. */
export interface DynamicStepDiagnostics {
  /** Combined rock + water volumetric heat capacity at the frozen state. */
  ctKjM3C: number;
  /** Production fluid enthalpy removed per kg (wellhead basis), kJ/kg. */
  hProdKjKg: number;
  /** Injection fluid enthalpy added per kg, kJ/kg. */
  hInjKjKg: number;
  /** Recharge enthalpy added per kg, kJ/kg. */
  hRechargeKjKg: number;
  /** Net mass change over the step, kg. */
  dMassKg: number;
  /** Net thermal-energy change over the step, PJ. */
  dEnergyPj: number;
  /** Specific available work at the new state, kJ/kg. */
  specificWorkKjKg: number;
}

/** Result of one pure `step`: the next state plus its diagnostics. */
export interface DynamicStepResult {
  state: ReservoirState;
  diagnostics: DynamicStepDiagnostics;
}
