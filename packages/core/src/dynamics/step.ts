/**
 * The pure dynamic update (Phase 1): one explicit-Euler tank step.
 *
 * Reduced-order mass and energy balance for a single well-mixed
 * liquid-dominated block, with a linearised compressible-tank pressure
 * response. Pure: same (state, controls, params, dt), same result; no
 * randomness, no I/O. Every step returns its diagnostics so a trajectory can
 * be audited rather than merely believed.
 *
 * ```
 * Mass:   M_{t+1} = M_t + (q_inj - q_prod + q_recharge) * dt
 * Energy: E_{t+1} = E_t + (q_inj*h_inj + q_re*h_re - q_prod*h_prod) * dt / 1e12
 *   h_prod = hRes(T_t) - D * 9.81 / 1000   [kJ/kg, wellhead basis as in physics.ts]
 *   h_inj  = hInj(T_inj)                   [kJ/kg, default hL at 60 degC, no p dependence]
 *   h_re   = hRes(T_t)                     [kJ/kg, recharge arrives at reservoir T]
 * Temperature (explicit inversion of static eq. 2 with frozen CT):
 *   CT_t = rho(p_t,T_t)*cp(p_t,T_t)*phi + (1-phi)*CR
 *   T_{t+1} = Ta + E_{t+1} * 1e12 / (V * CT_t)
 * Pressure (linearised storage response to the mass balance):
 *   p_{t+1} = p_t + (M_{t+1} - M_t) / (rho_t * Vp * cTotal)
 * Power diagnostic (static exergy eqs. 7-9 at the new state and current rate):
 *   w = (hWH - ho) - (Ta + 273.15) * (sWH - so)
 *   P_inst = q_prod * w * u / (1000 * F)   [MWe, nameplate-equivalent]
 * ```
 *
 * Energy is stored relative to the ambient sink, exactly like static `QR`, so
 * `E = 0` means `T = Ta`. Mass and energy conversion: q (kg/s) x h (kJ/kg) x
 * dt (s) = kJ; 1 PJ = 1e12 kJ because 1 Pg x 1 kJ/kg = 1 PJ.
 *
 * Deliberate V1 simplifications (each has an ASSUMPTIONS.md entry): explicit
 * Euler with frozen properties (exact only as dt -> 0); pressure decoupled
 * from temperature except through the frozen density; recharge thermally
 * neutral at reservoir temperature; no conduction, chemistry, boiling or
 * spatial gradients; injection pressure ignored.
 */

import { cpPT, hLT, psatT, rhoPT, sLT, sPh } from '../steam/index.js';
import { REGION1_MAX_C, REGION1_MIN_C } from '../steam/index.js';
import { assertValidControls } from './schedule.js';
import type {
  Controls,
  DynamicParams,
  DynamicStepDiagnostics,
  DynamicStepResult,
  EnthalpyProvider,
  ReservoirState,
} from './types.js';

/** kJ per PJ. */
const KJ_PER_PJ = 1e12;

/** Providers for reservoir and injection enthalpy; default both to hL(T). */
export interface StepEnthalpyProviders {
  /** Reservoir saturated-liquid enthalpy; default `hLT`. */
  reservoir?: EnthalpyProvider;
  /** Injection-fluid enthalpy; default `hLT`. Takes (T_inj) — pressure ignored in V1. */
  injection?: EnthalpyProvider;
}

/**
 * Combined rock + water volumetric heat capacity at (p, T) — static eq. 1.
 * Extracted so assimilation can rebuild a consistent energy after a state
 * update using the identical formula the step itself uses.
 */
export function combinedHeatCapacity(
  pressureBar: number,
  temperatureC: number,
  params: DynamicParams,
): number {
  return (
    rhoPT(pressureBar, temperatureC) * cpPT(pressureBar, temperatureC) * params.porosity +
    (1 - params.porosity) * params.rockHeatCapacityKjM3C
  );
}

/**
 * Stored thermal energy for a (T, p) pair — static eq.-2 form
 * `V · CT(p,T) · (T − Ta)`. Same re-anchor convention as `initialDynamicState`.
 */
export function thermalEnergyFromTP(
  temperatureC: number,
  pressureBar: number,
  params: DynamicParams,
): number {
  return (
    (params.volumeM3 * combinedHeatCapacity(pressureBar, temperatureC, params) *
      (temperatureC - params.ambientTemperatureC)) / KJ_PER_PJ
  );
}

/**
 * Specific available work at a (T, p) pair — static exergy eq. 7 per kg.
 */
export function specificWorkKjKg(
  temperatureC: number,
  pressureBar: number,
  params: DynamicParams,
  providers: StepEnthalpyProviders = {},
): number {
  const hRes = providers.reservoir ?? hLT;
  const saturationBar = psatT(temperatureC);
  const hwhKjKg = hRes(temperatureC, pressureBar) - (params.depthM * 9.81) / 1000;
  const swhKjKgK = sPh(saturationBar, hwhKjKg);
  const hoKjKg = hLT(params.ambientTemperatureC);
  const soKjKgK = sLT(params.ambientTemperatureC);
  return hwhKjKg - hoKjKg - (params.ambientTemperatureC + 273.15) * (swhKjKgK - soKjKgK);
}

/**
 * Instantaneous nameplate-equivalent capacity at a (T, p) pair and production
 * rate — static exergy eqs. 7–9. Identical formula to the in-step diagnostic.
 */
export function instantaneousCapacity(
  temperatureC: number,
  pressureBar: number,
  productionKgS: number,
  params: DynamicParams,
  providers: StepEnthalpyProviders = {},
): number {
  const workKjKg = specificWorkKjKg(temperatureC, pressureBar, params, providers);
  return (
    (productionKgS * workKjKg * params.utilizationFactor) / (1000 * params.capacityFactor)
  );
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`step: ${name} must be finite, got ${value}.`);
  }
}

/** Throw `RangeError` if the incoming state or params are invalid. */
function assertValidStepInputs(
  state: ReservoirState,
  controls: Controls,
  params: DynamicParams,
  dtSeconds: number,
): void {
  requireFinite(state.timeYears, 'state.timeYears');
  requireFinite(state.temperatureC, 'state.temperatureC');
  requireFinite(state.pressureBar, 'state.pressureBar');
  requireFinite(state.fluidMassKg, 'state.fluidMassKg');
  requireFinite(state.thermalEnergyPj, 'state.thermalEnergyPj');
  requireFinite(state.cumulativeProducedKg, 'state.cumulativeProducedKg');
  requireFinite(state.cumulativeInjectedKg, 'state.cumulativeInjectedKg');
  if (state.temperatureC <= REGION1_MIN_C || state.temperatureC >= REGION1_MAX_C) {
    throw new RangeError(
      `step: state.temperatureC ${state.temperatureC} degC is outside the IF97 Region 1 ` +
        `domain (${REGION1_MIN_C} < T < ${REGION1_MAX_C} degC).`,
    );
  }
  if (state.pressureBar <= 0) throw new RangeError(`step: state.pressureBar must be positive, got ${state.pressureBar}.`);
  if (state.fluidMassKg <= 0) throw new RangeError(`step: state.fluidMassKg must be positive, got ${state.fluidMassKg}.`);
  assertValidControls(controls);
  if (controls.injectionTemperatureC <= REGION1_MIN_C || controls.injectionTemperatureC >= REGION1_MAX_C) {
    throw new RangeError(
      `step: injectionTemperatureC ${controls.injectionTemperatureC} degC is outside ` +
        `(${REGION1_MIN_C}, ${REGION1_MAX_C}) degC.`,
    );
  }
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    throw new RangeError(`step: dtSeconds must be positive, got ${dtSeconds}.`);
  }
  if (!Number.isFinite(params.volumeM3) || params.volumeM3 <= 0) {
    throw new RangeError(`step: params.volumeM3 must be positive, got ${params.volumeM3}.`);
  }
  if (!Number.isFinite(params.poreVolumeM3) || params.poreVolumeM3 <= 0) {
    throw new RangeError(`step: params.poreVolumeM3 must be positive, got ${params.poreVolumeM3}.`);
  }
  if (params.porosity < 0 || params.porosity >= 1) {
    throw new RangeError(`step: params.porosity must lie in [0, 1), got ${params.porosity}.`);
  }
  if (!Number.isFinite(params.rockHeatCapacityKjM3C) || params.rockHeatCapacityKjM3C <= 0) {
    throw new RangeError(`step: params.rockHeatCapacityKjM3C must be positive, got ${params.rockHeatCapacityKjM3C}.`);
  }
  if (params.utilizationFactor <= 0 || params.utilizationFactor > 1) {
    throw new RangeError(`step: params.utilizationFactor must lie in (0, 1], got ${params.utilizationFactor}.`);
  }
  if (params.capacityFactor <= 0 || params.capacityFactor > 1) {
    throw new RangeError(`step: params.capacityFactor must lie in (0, 1], got ${params.capacityFactor}.`);
  }
  if (!Number.isFinite(params.totalCompressibilityPerBar) || params.totalCompressibilityPerBar <= 0) {
    throw new RangeError(
      `step: params.totalCompressibilityPerBar must be positive, got ${params.totalCompressibilityPerBar}.`,
    );
  }
  if (!Number.isFinite(params.rechargeKgS) || params.rechargeKgS < 0) {
    throw new RangeError(`step: params.rechargeKgS cannot be negative, got ${params.rechargeKgS}.`);
  }
}

/**
 * Advance the reservoir by `dtSeconds` under `controls`. Pure.
 *
 * @throws {RangeError} on any invalid input, on mass depletion (M <= 0), on
 * non-positive pressure, or when the updated temperature leaves Region 1.
 */
export function step(
  state: ReservoirState,
  controls: Controls,
  params: DynamicParams,
  dtSeconds: number,
  providers: StepEnthalpyProviders = {},
): DynamicStepResult {
  assertValidStepInputs(state, controls, params, dtSeconds);
  const hRes = providers.reservoir ?? hLT;
  const hInjFn = providers.injection ?? hLT;

  // Frozen properties at the incoming state.
  const densityKgM3 = rhoPT(state.pressureBar, state.temperatureC);
  const ctKjM3C = combinedHeatCapacity(state.pressureBar, state.temperatureC, params);

  // Specific enthalpies. Production uses the wellhead basis (static eq. 4);
  // injection uses the injected-fluid temperature with no pressure dependence;
  // recharge arrives at reservoir temperature (thermally neutral by design).
  const hProdKjKg = hRes(state.temperatureC, state.pressureBar) - (params.depthM * 9.81) / 1000;
  const hInjKjKg = hInjFn(controls.injectionTemperatureC, state.pressureBar);
  const hRechargeKjKg = params.rechargeEnthalpyKjKg ?? hRes(state.temperatureC, state.pressureBar);
  for (const [name, h] of [['hProdKjKg', hProdKjKg], ['hInjKjKg', hInjKjKg], ['hRechargeKjKg', hRechargeKjKg]] as const) {
    if (!Number.isFinite(h)) throw new RangeError(`step: computed ${name} is not finite (${h}).`);
  }

  // Balances.
  const dMassKg =
    (controls.injectionKgS - controls.productionKgS + params.rechargeKgS) * dtSeconds;
  const nextMassKg = state.fluidMassKg + dMassKg;
  if (!(nextMassKg > 0)) {
    throw new RangeError(
      `step: fluid mass depleted (M ${state.fluidMassKg.toExponential(3)} kg + dM ${dMassKg.toExponential(3)} kg); ` +
        'extraction exceeds the tank at this dt.',
    );
  }
  const dEnergyPj =
    ((controls.injectionKgS * hInjKjKg +
      params.rechargeKgS * hRechargeKjKg -
      controls.productionKgS * hProdKjKg) * dtSeconds) / KJ_PER_PJ;
  const nextEnergyPj = state.thermalEnergyPj + dEnergyPj;

  // Explicit temperature inversion of static eq. 2 with frozen CT.
  const nextTemperatureC =
    params.ambientTemperatureC + (nextEnergyPj * KJ_PER_PJ) / (params.volumeM3 * ctKjM3C);
  if (nextTemperatureC <= REGION1_MIN_C || nextTemperatureC >= REGION1_MAX_C) {
    throw new RangeError(
      `step: updated temperature ${nextTemperatureC.toFixed(2)} degC left the IF97 Region 1 domain; ` +
        'V1 covers liquid-dominated tanks only.',
    );
  }

  // Linearised pressure response to the mass balance (frozen density).
  const nextPressureBar =
    state.pressureBar + dMassKg / (densityKgM3 * params.poreVolumeM3 * params.totalCompressibilityPerBar);
  if (!(nextPressureBar > 0)) {
    throw new RangeError(
      `step: updated pressure ${nextPressureBar.toFixed(3)} bar is not positive; ` +
        'net withdrawal exceeded pressure storage at this dt.',
    );
  }

  // Power diagnostic: static exergy per kg at the new state, times current rate.
  const workKjKg = specificWorkKjKg(nextTemperatureC, nextPressureBar, params, providers);
  const capacityMweInstant = instantaneousCapacity(
    nextTemperatureC,
    nextPressureBar,
    controls.productionKgS,
    params,
    providers,
  );

  const dtYears = dtSeconds / (365.25 * 24 * 60 * 60);
  const diagnostics: DynamicStepDiagnostics = {
    ctKjM3C,
    hProdKjKg,
    hInjKjKg,
    hRechargeKjKg,
    dMassKg,
    dEnergyPj,
    specificWorkKjKg: workKjKg,
  };
  return {
    diagnostics,
    state: {
      timeYears: state.timeYears + dtYears,
      temperatureC: nextTemperatureC,
      pressureBar: nextPressureBar,
      fluidMassKg: nextMassKg,
      thermalEnergyPj: nextEnergyPj,
      cumulativeProducedKg: state.cumulativeProducedKg + controls.productionKgS * dtSeconds,
      cumulativeInjectedKg: state.cumulativeInjectedKg + controls.injectionKgS * dtSeconds,
      capacityMweInstant,
    },
  };
}
