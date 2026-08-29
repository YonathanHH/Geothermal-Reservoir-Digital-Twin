/**
 * Sampling for the model inputs, kept strictly separate from the physics.
 *
 * ## Why Beta-PERT, and why the inverse CDF
 *
 * Resource assessment usually starts from a three-point estimate: a plausible minimum,
 * a most-likely value, and a plausible maximum. Beta-PERT is the standard way to turn
 * that into a distribution - it is a Beta distribution reparameterised so its mean is
 * `(min + 4*mostLikely + max) / 6`, giving the most-likely value four times the weight
 * of either bound while staying bounded by them.
 *
 * Sampling it requires the **inverse** CDF applied to a uniform draw. This is worth
 * stating explicitly because the opposite mistake is easy to make and quiet: applying
 * the forward CDF to a uniform draw compiles, runs, produces numbers in the right range,
 * and yields the wrong distribution. In the symmetric case it degenerates all the way to
 * a uniform draw, discarding the most-likely value entirely and inflating the spread -
 * a P10 that is far too optimistic, with nothing in the output that looks wrong.
 * `betaCdf` is therefore used only to build `betaInv`, never to sample directly.
 */
import type { Rng } from './rng.js';
import type { DistributionLabel } from './types.js';

// ---------------------------------------------------------------------------
// Regularized incomplete beta function
// ---------------------------------------------------------------------------

const LN_GAMMA_COF = [
  76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
  0.1208650973866179e-2, -0.5395239384953e-5,
];

/** Natural log of the gamma function (Lanczos approximation). */
function lnGamma(x: number): number {
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += LN_GAMMA_COF[j]! / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued-fraction expansion for the incomplete beta function (Lentz's method). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/**
 * Regularized incomplete beta I_x(a, b), i.e. the Beta CDF on the unit interval.
 *
 * Exported for testing and for inverting; do not sample with it directly - see the
 * module comment.
 */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Inverse of `betaCdf`, by bisection. Accurate to ~1e-15 in the variate. */
export function betaInv(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Beta-PERT
// ---------------------------------------------------------------------------

export interface PertShape {
  /** (min + 4*mostLikely + max) / 6. */
  mean: number;
  /** Beta shape parameter alpha. */
  alpha: number;
  /** Beta shape parameter beta. */
  beta: number;
}

/**
 * Relative tolerance for detecting the symmetric case.
 *
 * When `mostLikely` is the midpoint of the range, the general expressions below are 0/0.
 * Exact floating-point equality is not a safe test for that: `(0.35 + 4*0.4 + 0.45) / 6`
 * evaluates to 0.4000000000000001, not 0.4, so a symmetric input can miss the branch and
 * have its shape parameters computed from a ratio of two rounding errors - which can be
 * negative, and is never meaningful. Compare with a tolerance instead.
 */
const SYMMETRY_EPSILON = 1e-12;

/**
 * Beta-PERT shape parameters for a three-point estimate.
 *
 * @throws {RangeError} if the three points do not describe a valid distribution.
 */
export function pertShape(mostLikely: number, min: number, max: number): PertShape {
  if (!(max > min)) {
    throw new RangeError(`pertShape: max (${max}) must be greater than min (${min}).`);
  }
  if (mostLikely < min || mostLikely > max) {
    throw new RangeError(
      `pertShape: mostLikely (${mostLikely}) must lie between min (${min}) and max (${max}).`,
    );
  }

  const mean = (min + 4 * mostLikely + max) / 6;
  const scale = max - min;

  // Symmetric case: the PERT limit is alpha = beta = 3.
  if (Math.abs(mostLikely - mean) <= SYMMETRY_EPSILON * scale) {
    return { mean, alpha: 3, beta: 3 };
  }

  const alpha = ((mean - min) * (2 * mostLikely - min - max)) / ((mostLikely - mean) * scale);
  const beta = (alpha * (max - mean)) / (mean - min);

  if (!(alpha > 0) || !(beta > 0)) {
    throw new RangeError(
      `pertShape: min=${min}, mostLikely=${mostLikely}, max=${max} gives invalid shape ` +
        `parameters (alpha=${alpha}, beta=${beta}).`,
    );
  }
  return { mean, alpha, beta };
}

/** Draw from a Beta-PERT distribution: the inverse CDF applied to a uniform draw. */
export function pert(rng: Rng, mostLikely: number, min: number, max: number): number {
  const { alpha, beta } = pertShape(mostLikely, min, max);
  return min + (max - min) * betaInv(rng(), alpha, beta);
}

// ---------------------------------------------------------------------------
// Other samplers
// ---------------------------------------------------------------------------

/** Draw from a triangular distribution by its inverse CDF. */
export function triangular(rng: Rng, mostLikely: number, min: number, max: number): number {
  if (!(max > min)) {
    throw new RangeError(`triangular: max (${max}) must be greater than min (${min}).`);
  }
  const y = rng();
  const split = (mostLikely - min) / (max - min);
  return y <= split
    ? min + Math.sqrt(y * (mostLikely - min) * (max - min))
    : max - Math.sqrt((1 - y) * (max - mostLikely) * (max - min));
}

/** Draw uniformly on [min, max). */
export function uniform(rng: Rng, min: number, max: number): number {
  return (max - min) * rng() + min;
}

/** Draw one value for a parameter with the given distribution. */
export function sample(
  rng: Rng,
  distribution: DistributionLabel,
  mostLikely: number,
  min: number,
  max: number,
): number {
  switch (distribution) {
    case 'PERT':
      return pert(rng, mostLikely, min, max);
    case 'Triangular':
      return triangular(rng, mostLikely, min, max);
    case 'Uniform':
      return uniform(rng, min, max);
    case 'Fixed':
      return mostLikely;
  }
}
