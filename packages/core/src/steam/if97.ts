/**
 * IAPWS-IF97 water/steam properties — Region 1 (compressed liquid) and Region 4 (the
 * saturation line), which is the whole domain the volumetric model touches.
 *
 * Implemented directly from the IAPWS Industrial Formulation 1997 rather than taken from
 * a library, so the model has no runtime dependencies and every coefficient table can be
 * checked line by line against the published release. Section and equation references in
 * the comments below point at that document, and the unit tests pin each function to its
 * published verification points.
 *
 * Units here are SI-internal: pressure in MPa, temperature in K, enthalpy in kJ/kg,
 * entropy in kJ/(kg·K), specific volume in m³/kg. The `../steam` facade converts to and
 * from the bar / °C convention used by the rest of the model.
 */

/** Specific gas constant for water, kJ/(kg·K). */
const R = 0.461526;

/** Region 1 basic-equation coefficients: Eq. 7, Table 2, page 6. */
const I1 = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 8, 8, 21, 23, 29, 30, 31, 32];
const J1 = [-2, -1, 0, 1, 2, 3, 4, 5, -9, -7, -1, 0, 1, 3, -3, 0, 1, 3, 17, -4, 0, 6, -5, -2, 10, -8, -11, -6, -29, -31, -38, -39, -40, -41];
const N1 = [
  0.14632971213167, -0.84548187169114, -3.756360367204, 3.3855169168385,
  -0.95791963387872, 0.15772038513228, -0.016616417199501, 8.1214629983568e-4,
  2.8319080123804e-4, -6.0706301565874e-4, -0.018990068218419, -0.032529748770505,
  -0.021841717175414, -5.283835796993e-5, -4.7184321073267e-4, -3.0001780793026e-4,
  4.7661393906987e-5, -4.4141845330846e-6, -7.2694996297594e-16, -3.1679644845054e-5,
  -2.8270797985312e-6, -8.5205128120103e-10, -2.2425281908e-6, -6.5171222895601e-7,
  -1.4341729937924e-13, -4.0516996860117e-7, -1.2734301741641e-9, -1.7424871230634e-10,
  -6.8762131295531e-19, 1.4478307828521e-20, 2.6335781662795e-23, -1.1947622640071e-23,
  1.8228094581404e-24, -9.3537087292458e-26,
];

/** Region 1 backward T(p,h) coefficients: Eq. 11, Table 6, page 10. */
const IB = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 5, 6];
const JB = [0, 1, 2, 6, 22, 32, 0, 1, 2, 3, 4, 10, 32, 10, 32, 10, 32, 32, 32, 32];
const NB = [
  -238.72489924521, 404.21188637945, 113.49746881718, -5.8457616048039,
  -1.528548241314e-4, -1.0866707695377e-6, -13.391744872602, 43.211039183559,
  -54.010067170506, 30.535892203916, -6.5964749423638, 9.3965400878363e-3,
  1.157364750534e-7, -2.5858641282073e-5, -4.0644363084799e-9, 6.6456186191635e-8,
  8.0670734103027e-11, -9.3477771213947e-13, 5.8265442020601e-15, -1.5020185953503e-17,
];

const pow = Math.pow;

/** Specific volume in Region 1, m³/kg. `p` in MPa, `t` in K. */
export function v1_pT(p: number, t: number): number {
  const pi = p / 16.53;
  const tau = 1386 / t;
  let gPi = 0;
  for (let i = 0; i < 34; i++) {
    gPi -= N1[i]! * I1[i]! * pow(7.1 - pi, I1[i]! - 1) * pow(tau - 1.222, J1[i]!);
  }
  return ((R * t) / p) * pi * gPi / 1000;
}

/** Specific enthalpy in Region 1, kJ/kg. `p` in MPa, `t` in K. */
export function h1_pT(p: number, t: number): number {
  const pi = p / 16.53;
  const tau = 1386 / t;
  let gTau = 0;
  for (let i = 0; i < 34; i++) {
    gTau += N1[i]! * pow(7.1 - pi, I1[i]!) * J1[i]! * pow(tau - 1.222, J1[i]! - 1);
  }
  return R * t * tau * gTau;
}

/** Specific entropy in Region 1, kJ/(kg·K). `p` in MPa, `t` in K. */
export function s1_pT(p: number, t: number): number {
  const pi = p / 16.53;
  const tau = 1386 / t;
  let g = 0;
  let gTau = 0;
  for (let i = 0; i < 34; i++) {
    gTau += N1[i]! * pow(7.1 - pi, I1[i]!) * J1[i]! * pow(tau - 1.222, J1[i]! - 1);
    g += N1[i]! * pow(7.1 - pi, I1[i]!) * pow(tau - 1.222, J1[i]!);
  }
  return R * tau * gTau - R * g;
}

/** Isobaric heat capacity in Region 1, kJ/(kg·K). `p` in MPa, `t` in K. */
export function cp1_pT(p: number, t: number): number {
  const pi = p / 16.53;
  const tau = 1386 / t;
  let gTauTau = 0;
  for (let i = 0; i < 34; i++) {
    gTauTau += N1[i]! * pow(7.1 - pi, I1[i]!) * J1[i]! * (J1[i]! - 1) * pow(tau - 1.222, J1[i]! - 2);
  }
  return -R * tau * tau * gTauTau;
}

/** Backward equation T(p,h) for Region 1, K. `p` in MPa, `h` in kJ/kg. */
export function t1_ph(p: number, h: number): number {
  const eta = h / 2500;
  let t = 0;
  for (let i = 0; i < 20; i++) t += NB[i]! * pow(p, IB[i]!) * pow(eta + 1, JB[i]!);
  return t;
}

/** Saturation pressure, MPa. Eq. 30, Section 8.1, page 33. `t` in K. */
export function p4_T(t: number): number {
  const theta = t - 0.23855557567849 / (t - 650.17534844798);
  const a = theta * theta + 1167.0521452767 * theta - 724213.16703206;
  const b = -17.073846940092 * theta * theta + 12020.82470247 * theta - 3232555.0322333;
  const c = 14.91510861353 * theta * theta - 4823.2657361591 * theta + 405113.40542057;
  return pow((2 * c) / (-b + Math.sqrt(b * b - 4 * a * c)), 4);
}

/** Saturation temperature, K. Eq. 31, Section 8.2, page 34. `p` in MPa. */
export function t4_p(p: number): number {
  const beta = pow(p, 0.25);
  const e = beta * beta - 17.073846940092 * beta + 14.91510861353;
  const f = 1167.0521452767 * beta * beta + 12020.82470247 * beta - 4823.2657361591;
  const g = -724213.16703206 * beta * beta - 3232555.0322333 * beta + 405113.40542057;
  const d = (2 * g) / (-f - Math.sqrt(f * f - 4 * e * g));
  const k = 650.17534844798 + d;
  return (k - Math.sqrt(k * k - 4 * (-0.23855557567849 + 650.17534844798 * d))) / 2;
}

/**
 * Saturated-liquid enthalpy at pressure `p` (MPa), kJ/kg.
 *
 * Below 16.529 MPa this is the Region 1 equation evaluated at the saturation
 * temperature. Above that pressure the saturated liquid enters Region 3, which is
 * outside this model's domain and deliberately not implemented.
 */
export function h4L_p(p: number): number {
  if (!(p > 0.000611657 && p < 16.529)) {
    throw new RangeError(
      `h4L_p: pressure ${p} MPa is outside the implemented domain ` +
        `(0.000611657 < p < 16.529 MPa; above this the saturated liquid enters Region 3).`,
    );
  }
  return h1_pT(p, t4_p(p));
}
