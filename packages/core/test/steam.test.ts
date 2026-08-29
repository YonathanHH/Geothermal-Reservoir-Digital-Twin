import { describe, expect, it } from 'vitest';
import * as steam from '../src/steam/index.js';

/**
 * The IF97 implementation is the foundation everything else rests on, so every function
 * is pinned to the verification points published with the standard.
 */
describe('IAPWS-IF97 Region 1', () => {
  // Release on the IAPWS Industrial Formulation 1997, Table 5.
  const verification = [
    { p: 3, t: 300, v: 0.100215168e-2, h: 0.115331273e3, s: 0.392294792, cp: 0.417301218e1 },
    { p: 80, t: 300, v: 0.971180894e-3, h: 0.184142828e3, s: 0.368563852, cp: 0.401008987e1 },
    { p: 3, t: 500, v: 0.120241800e-2, h: 0.975542239e3, s: 0.258041912e1, cp: 0.465580682e1 },
  ];

  /**
   * The published values are quoted to nine significant figures, so agreement is
   * asserted relatively rather than to a fixed number of decimals - specific volume is
   * of order 1e-3 and enthalpy of order 1e3, and a single decimal tolerance cannot be
   * meaningful for both.
   */
  const agreesTo = (actual: number, expected: number, relative = 1e-8) =>
    expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(relative);

  for (const { p, t, v, h, s, cp } of verification) {
    it(`matches the published verification point at ${p} MPa, ${t} K`, () => {
      agreesTo(steam.v1_pT(p, t), v);
      agreesTo(steam.h1_pT(p, t), h);
      agreesTo(steam.s1_pT(p, t), s);
      agreesTo(steam.cp1_pT(p, t), cp);
    });
  }

  it('matches the published backward T(p,h) verification points', () => {
    // Table 7.
    expect(steam.t1_ph(3, 500)).toBeCloseTo(0.391798509e3, 6);
    expect(steam.t1_ph(80, 500)).toBeCloseTo(0.378108626e3, 6);
    expect(steam.t1_ph(80, 1500)).toBeCloseTo(0.611041229e3, 6);
  });
});

describe('IAPWS-IF97 Region 4 (saturation line)', () => {
  it('matches the published saturation-pressure verification points', () => {
    // Table 35.
    expect(steam.p4_T(300)).toBeCloseTo(0.353658941e-2, 11);
    expect(steam.p4_T(500)).toBeCloseTo(0.263889776e1, 8);
    expect(steam.p4_T(600)).toBeCloseTo(0.123443146e2, 7);
  });

  it('matches the published saturation-temperature verification points', () => {
    // Table 36.
    expect(steam.t4_p(0.1)).toBeCloseTo(0.372755919e3, 6);
    expect(steam.t4_p(1)).toBeCloseTo(0.453035632e3, 6);
    expect(steam.t4_p(10)).toBeCloseTo(0.584149488e3, 6);
  });

  it('round-trips pressure and temperature along the saturation line', () => {
    for (const t of [300, 350, 400, 450, 500, 550, 600]) {
      expect(steam.t4_p(steam.p4_T(t))).toBeCloseTo(t, 8);
    }
  });
});

describe('engineering-units facade', () => {
  /**
   * Saturated liquid water at 10 degC: h ~ 42.02 kJ/kg and s ~ 0.1511 kJ/(kg.K) are
   * standard steam-table values, so these pin the unit conversions as well as the
   * underlying equations.
   */
  it('gives the textbook saturated-liquid properties at 10 degC', () => {
    expect(steam.hLT(10)).toBeCloseTo(42.0211, 4);
    expect(steam.sLT(10)).toBeCloseTo(0.151085, 6);
  });

  it('converts pressure to bar', () => {
    // 100 degC water boils at ~1.014 bar.
    expect(steam.psatT(100)).toBeCloseTo(1.0141797792, 8);
    expect(steam.tsatP(1.0141797792)).toBeCloseTo(100, 8);
  });

  it('gives liquid water a plausible density and heat capacity', () => {
    const p = 1.001 * steam.psatT(200);
    expect(steam.rhoPT(p, 200)).toBeGreaterThan(800);
    expect(steam.rhoPT(p, 200)).toBeLessThan(900);
    expect(steam.cpPT(p, 200)).toBeGreaterThan(4);
    expect(steam.cpPT(p, 200)).toBeLessThan(5);
  });

  /**
   * Feeding the saturated-liquid enthalpy back through `sPh` should recover the
   * saturated-liquid entropy, but only to the accuracy of the IF97 *backward* equation
   * T(p,h), which is specified to about 25 mK. At cp ~ 4.5 kJ/(kg.K) and T ~ 500 K that
   * is ds ~ 2e-4 kJ/(kg.K), so a tighter assertion would be testing the standard's
   * tolerance rather than this port.
   *
   * The consequence for the model is negligible: the term this feeds,
   * Ta * (sWH - so), shifts by well under 0.1% of the available work.
   */
  it('is consistent between sPh and sLT on the saturation line', () => {
    for (const t of [50, 150, 200, 250, 300]) {
      const p = steam.psatT(t);
      expect(Math.abs(steam.sPh(p, steam.hLT(t)) - steam.sLT(t))).toBeLessThan(5e-4);
    }
  });

  it('rejects temperatures outside the implemented Region 1 domain', () => {
    expect(() => steam.hLT(400)).toThrow(RangeError);
    expect(() => steam.hLT(-5)).toThrow(RangeError);
    expect(() => steam.sLT(0)).toThrow(RangeError);
  });

  it('rejects an enthalpy above the saturated-liquid value in sPh', () => {
    // Two-phase and vapour regions are deliberately not implemented.
    expect(() => steam.sPh(steam.psatT(200), 2000)).toThrow(RangeError);
  });
});
