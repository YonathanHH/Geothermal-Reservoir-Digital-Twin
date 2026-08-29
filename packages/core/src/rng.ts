/**
 * Seeded pseudo-random number generation.
 *
 * Reproducibility is a hard requirement: an assessment that cannot be re-run to the same
 * numbers cannot be audited. Every run records its seed, and the same seed always yields
 * the same draws.
 *
 * mulberry32 is used for its speed and short state. The model's uncertainty is far
 * coarser than any statistical shortcoming of a 32-bit generator, but if that ever stops
 * being true, this is the one module to replace.
 */

export interface Rng {
  /** Next uniform variate in [0, 1). */
  (): number;
}

/** Create a deterministic uniform generator from a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an arbitrary string to a 32-bit seed, so runs can be named rather than numbered. */
export function seedFromString(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
