/**
 * Sensor-noise primitives (Phase 1.5).
 *
 * Gaussian noise via Box–Muller from the repo's seeded `mulberry32` streams.
 * Each transform consumes exactly two uniform draws and uses one of them; the
 * spare is discarded so the consumption pattern stays obvious (one observation
 * costs two uniforms plus one dropout draw). Kept in this module — not in
 * `rng.ts` — so no existing file changes behaviour.
 */

import type { Rng } from '../rng.js';

/**
 * One standard-normal variate from uniform draws.
 *
 * Guards the log against a 0 draw (probability ~2^-32, but a NaN here would
 * poison a whole telemetry run silently, and loud is cheaper than sorry).
 */
export function gaussianSample(rng: Rng): number {
  let u1 = rng();
  while (u1 <= 0) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
