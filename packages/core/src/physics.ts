/**
 * The deterministic volumetric calculation chain. Methodology follows the USGS
 * volumetric "heat in place" method (Circular 790, 1978): estimate the thermal energy
 * stored in the rock and water, take the recoverable fraction, convert it to available
 * work through an exergy balance against the ambient sink, and spread the resulting
 * electrical energy over the project life.
 *
 * Pure: same inputs, same outputs, no randomness, no I/O. Every intermediate is returned
 * rather than folded into a single expression, so a discrepancy can be localised to one
 * line rather than merely noticed.
 *
 * Mass is carried in Pg (1e12 kg) so that available work falls out directly in PJ,
 * avoiding a x1e12 / /1e12 round trip through the enthalpy balance.
 */
import { psatT, rhoPT, cpPT, hLT, sLT, sPh } from './steam/index.js';
import { assertValidInputs } from './validate.js';
import type { ResourceInputs, ResourceResult } from './types.js';

/** Seconds in a year, using a 365.25-day convention. */
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

/**
 * Fraction above saturation pressure at which water properties are evaluated.
 *
 * Properties are taken just inside the compressed-liquid region rather than exactly on
 * the saturation line, where a region-detection routine may return the two-phase branch
 * and give a heat capacity that is not the liquid's.
 */
const LIQUID_PRESSURE_MARGIN = 1.001;

/**
 * Evaluate the full resource chain for one set of inputs.
 *
 * @throws {ModelInputError} if any input is outside the model's domain of validity.
 */
export function calculateResource(inputs: ResourceInputs): ResourceResult {
  assertValidInputs(inputs);

  const {
    areaKm2,
    thicknessM,
    temperatureC,
    recoveryFactor,
    utilizationFactor,
    porosity,
    rockHeatCapacityKjM3C,
    depthM,
    ambientTemperatureC,
    capacityFactor,
    lifetimeYears,
  } = inputs;

  const saturationPressureBar = psatT(temperatureC);
  const liquidPressureBar = LIQUID_PRESSURE_MARGIN * saturationPressureBar;

  // Combined volumetric heat capacity of the rock/water system, kJ/(m3.degC).
  const ctKjM3C =
    rhoPT(liquidPressureBar, temperatureC) * cpPT(liquidPressureBar, temperatureC) * porosity +
    (1 - porosity) * rockHeatCapacityKjM3C;

  // Thermal energy in place, PJ. km2 x m x kJ/(m3.degC) x degC = 1e6 kJ, hence /1e6.
  const qrPj = (areaKm2 * thicknessM * ctKjM3C * (temperatureC - ambientTemperatureC)) / 1e6;

  // Fraction of that energy recoverable at the wellhead, PJ.
  const qwhPj = qrPj * recoveryFactor;

  // Wellhead enthalpy: saturated liquid at reservoir temperature, less the hydrostatic
  // head lost climbing the well.
  const hwhKjKg = hLT(temperatureC) - (depthM * 9.81) / 1000;
  const hoKjKg = hLT(ambientTemperatureC);

  const swhKjKgK = sPh(saturationPressureBar, hwhKjKg);
  const soKjKgK = sLT(ambientTemperatureC);

  // Mass that must be produced to carry QWH across the wellhead-to-ambient enthalpy
  // drop, in Pg (1e12 kg): PJ / (kJ/kg) = 1e12 kg.
  const mwhPg = qwhPj / (hwhKjKg - hoKjKg);

  // Exergy: the thermodynamically available fraction of that heat, PJ.
  const waPj = mwhPg * (hwhKjKg - hoKjKg - (ambientTemperatureC + 273.15) * (swhKjKgK - soKjKgK));

  const ePj = waPj * utilizationFactor;

  // Average capacity sustaining that energy over the project life, MWe.
  const capacityMwe = (ePj * 1e9) / (capacityFactor * lifetimeYears * SECONDS_PER_YEAR);

  return { ctKjM3C, qrPj, qwhPj, hwhKjKg, hoKjKg, swhKjKgK, soKjKgK, mwhPg, waPj, ePj, capacityMwe };
}
