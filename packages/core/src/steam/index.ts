/**
 * Engineering-units facade over the IF97 core.
 *
 * Reservoir engineering works in bar and °C; IF97 is formulated in MPa and K. These
 * wrappers keep that conversion in exactly one place, so no caller has to remember which
 * convention the number in its hand is using.
 *
 * Every function is restricted to Region 1 / Region 4 below 350 °C, which covers the
 * whole liquid-dominated geothermal domain the model is defined for. Anything outside
 * throws rather than silently extrapolating.
 */
import { p4_T, t4_p, h1_pT, s1_pT, v1_pT, cp1_pT, t1_ph, h4L_p } from './if97.js';

/** Upper temperature of IF97 Region 1, °C (623.15 K). */
export const REGION1_MAX_C = 350;
/** Lower bound of the saturation line, °C (273.15 K exclusive). */
export const REGION1_MIN_C = 0;

const toK = (celsius: number) => celsius + 273.15;
const barToMPa = (bar: number) => bar / 10;
const mpaToBar = (mpa: number) => mpa * 10;

function assertLiquidDomain(temperatureC: number, fn: string): void {
  if (!Number.isFinite(temperatureC) || temperatureC <= REGION1_MIN_C || temperatureC >= REGION1_MAX_C) {
    throw new RangeError(
      `${fn}: temperature ${temperatureC} °C is outside the supported IF97 Region 1 domain ` +
        `(${REGION1_MIN_C} < T < ${REGION1_MAX_C} °C).`,
    );
  }
}

/** Saturation pressure at `temperatureC`, in bar. */
export function psatT(temperatureC: number): number {
  assertLiquidDomain(temperatureC, 'psatT');
  return mpaToBar(p4_T(toK(temperatureC)));
}

/** Saturation temperature at `pressureBar`, in °C. */
export function tsatP(pressureBar: number): number {
  return t4_p(barToMPa(pressureBar)) - 273.15;
}

/**
 * Saturated-liquid enthalpy at `temperatureC`, kJ/kg.
 *
 * Evaluated via the saturation pressure, i.e. `h1(p4(T), T4(p4(T)))`. The round trip
 * through `T4` is not an exact identity, but it keeps enthalpy and pressure consistent
 * with each other on the saturation line, which matters more here than recovering `T`
 * to the last bit.
 */
export function hLT(temperatureC: number): number {
  assertLiquidDomain(temperatureC, 'hLT');
  return h4L_p(p4_T(toK(temperatureC)));
}

/** Saturated-liquid entropy at `temperatureC`, kJ/(kg·K). */
export function sLT(temperatureC: number): number {
  assertLiquidDomain(temperatureC, 'sLT');
  return s1_pT(p4_T(toK(temperatureC)), toK(temperatureC));
}

/** Density at `pressureBar`, `temperatureC`, kg/m³. */
export function rhoPT(pressureBar: number, temperatureC: number): number {
  return 1 / vPT(pressureBar, temperatureC);
}

/** Specific volume at `pressureBar`, `temperatureC`, m³/kg. */
export function vPT(pressureBar: number, temperatureC: number): number {
  assertLiquidDomain(temperatureC, 'vPT');
  return v1_pT(barToMPa(pressureBar), toK(temperatureC));
}

/** Isobaric heat capacity at `pressureBar`, `temperatureC`, kJ/(kg·K). */
export function cpPT(pressureBar: number, temperatureC: number): number {
  assertLiquidDomain(temperatureC, 'cpPT');
  return cp1_pT(barToMPa(pressureBar), toK(temperatureC));
}

/** Specific enthalpy at `pressureBar`, `temperatureC`, kJ/kg. */
export function hPT(pressureBar: number, temperatureC: number): number {
  assertLiquidDomain(temperatureC, 'hPT');
  return h1_pT(barToMPa(pressureBar), toK(temperatureC));
}

/**
 * Specific entropy from pressure and enthalpy, kJ/(kg·K).
 *
 * Restricted to Region 1: the model evaluates this at the wellhead, whose enthalpy is
 * the saturated-liquid value less a hydrostatic term, so it always sits on the liquid
 * side. A subcooled check guards against callers straying into the two-phase region.
 */
export function sPh(pressureBar: number, enthalpyKjKg: number): number {
  const p = barToMPa(pressureBar);
  const hSatLiquid = h4L_p(p);
  if (enthalpyKjKg > hSatLiquid) {
    throw new RangeError(
      `sPh: enthalpy ${enthalpyKjKg} kJ/kg exceeds the saturated-liquid enthalpy ` +
        `${hSatLiquid} kJ/kg at ${pressureBar} bar; only Region 1 is implemented.`,
    );
  }
  return s1_pT(p, t1_ph(p, enthalpyKjKg));
}

export { p4_T, t4_p, h1_pT, s1_pT, v1_pT, cp1_pT, t1_ph, h4L_p };
