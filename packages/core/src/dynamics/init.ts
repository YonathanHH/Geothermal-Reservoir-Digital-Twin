/**
 * Initialise the dynamic state from the static resource assessment (Phase 1).
 *
 * The static model characterises the reservoir; the dynamic model evolves it.
 * Initial temperature, stored energy and fluid mass come from the static
 * inputs and equations, while production rate stays an explicit operating
 * control and is never derived from the static produced-mass figure (doing so
 * would make the dynamics circular).
 */

import { assertValidInputs } from '../validate.js';
import { cpPT, psatT, rhoPT } from '../steam/index.js';
import type { ResourceInputs } from '../types.js';
import type { DynamicParams, ReservoirState } from './types.js';

/** Dynamic overrides: sampled uncertain values. All fields configurable. */
export interface InitDynamicsOptions {
  /** Total compressibility, 1/bar. */
  totalCompressibilityPerBar: number;
  /** Natural recharge rate, kg/s. */
  rechargeKgS: number;
}

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`initialDynamicState: ${name} must be a positive finite number, got ${value}.`);
  }
}

/**
 * Build time-invariant dynamic parameters from static inputs.
 *
 * @throws {ModelInputError} if the static inputs are invalid (via `assertValidInputs`).
 * @throws {RangeError} if a dynamic value is invalid.
 */
export function toDynamicParams(
  inputs: ResourceInputs,
  options: InitDynamicsOptions,
): DynamicParams {
  assertValidInputs(inputs);
  if (!Number.isFinite(options.totalCompressibilityPerBar) || options.totalCompressibilityPerBar <= 0) {
    throw new RangeError(
      `initialDynamicState: totalCompressibilityPerBar must be positive, got ${options.totalCompressibilityPerBar}.`,
    );
  }
  if (!Number.isFinite(options.rechargeKgS) || options.rechargeKgS < 0) {
    throw new RangeError(
      `initialDynamicState: rechargeKgS cannot be negative, got ${options.rechargeKgS}.`,
    );
  }
  const volumeM3 = inputs.areaKm2 * 1e6 * inputs.thicknessM;
  requirePositiveFinite(volumeM3, 'reservoir volume');
  return {
    volumeM3,
    poreVolumeM3: volumeM3 * inputs.porosity,
    porosity: inputs.porosity,
    rockHeatCapacityKjM3C: inputs.rockHeatCapacityKjM3C,
    depthM: inputs.depthM,
    ambientTemperatureC: inputs.ambientTemperatureC,
    capacityFactor: inputs.capacityFactor,
    utilizationFactor: inputs.utilizationFactor,
    totalCompressibilityPerBar: options.totalCompressibilityPerBar,
    rechargeKgS: options.rechargeKgS,
  };
}

/**
 * Hydrostatic initial pressure: rho0 * g * D, in bar.
 *
 * Evaluated at saturated-liquid density at the initial temperature so the
 * initial state sits in the compressed-liquid region the static chain assumes.
 * Where the hydrostatic column does not clear the saturation pressure (hot and
 * shallow), the initial pressure is raised to `1.001 x psat(T)` — the same
 * liquid-margin convention as `physics.ts` — i.e. the feed zone is taken to be
 * pressurised. This keeps every static realization inside the V1 liquid domain
 * instead of rejecting hot fields outright; see ASSUMPTIONS.md.
 */
export function initialPressureBar(temperatureC: number, depthM: number): number {
  const rho0 = rhoPT(1.001 * psatT(temperatureC), temperatureC);
  const hydrostaticBar = (rho0 * 9.81 * depthM) / 1e5;
  const saturationBar = psatT(temperatureC);
  const pressureBar = Math.max(hydrostaticBar, 1.001 * saturationBar);
  if (!(pressureBar > 0) || !Number.isFinite(pressureBar)) {
    throw new RangeError(
      `initialDynamicState: computed initial pressure ${pressureBar} bar is not a positive finite number.`,
    );
  }
  return pressureBar;
}

/**
 * Initial reservoir state at t = 0.
 *
 * - `temperatureC` is the static reservoir temperature.
 * - `pressureBar` is the hydrostatic column at reservoir liquid density.
 * - `thermalEnergyPj` is the static eq.-2 form `V * CT(p0, T0) * (T0 - Ta)`,
 *   i.e. the static thermal-energy-in-place re-anchored at the dynamic initial
 *   pressure. It agrees with static `QR` (evaluated at `1.001 x psat`) to well
 *   under a percent — liquid properties barely move with pressure — and the
 *   re-anchor is what makes the tank self-consistent, so an idle reservoir
 *   stays exactly idle instead of drifting to a nearby fixed point.
 * - `fluidMassKg` is pore volume at saturated-liquid density at (p0, T0).
 * - `capacityMweInstant` is 0: no rate has been applied yet.
 */
export function initialDynamicState(
  inputs: ResourceInputs,
  options: InitDynamicsOptions,
): { state: ReservoirState; params: DynamicParams } {
  const params = toDynamicParams(inputs, options);
  const pressureBar = initialPressureBar(inputs.temperatureC, inputs.depthM);
  const densityKgM3 = rhoPT(pressureBar, inputs.temperatureC);
  const ctKjM3C =
    densityKgM3 * cpPT(pressureBar, inputs.temperatureC) * inputs.porosity +
    (1 - inputs.porosity) * inputs.rockHeatCapacityKjM3C;
  const thermalEnergyPj =
    (params.volumeM3 * ctKjM3C * (inputs.temperatureC - inputs.ambientTemperatureC)) / 1e12;
  const fluidMassKg = params.poreVolumeM3 * densityKgM3;
  if (!Number.isFinite(fluidMassKg) || fluidMassKg <= 0) {
    throw new RangeError(
      `initialDynamicState: computed fluid mass ${fluidMassKg} kg is not positive; check porosity and volume.`,
    );
  }
  return {
    params,
    state: {
      timeYears: 0,
      temperatureC: inputs.temperatureC,
      pressureBar,
      fluidMassKg,
      thermalEnergyPj,
      cumulativeProducedKg: 0,
      cumulativeInjectedKg: 0,
      capacityMweInstant: 0,
    },
  };
}
