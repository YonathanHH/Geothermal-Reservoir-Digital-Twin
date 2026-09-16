/**
 * Deterministic synthetic field layout (Phase 3).
 *
 * The reservoir footprint is an ellipse derived from the static area A: equal
 * area, modest 5:4 elongation so the field reads as a field rather than a
 * circle. Producers sit on an inner ring (the hot core), injectors on an
 * outer ring (peripheral injection, standard practice to delay thermal
 * breakthrough), and a single observation well sits near the centre. Angular
 * positions carry a small seeded jitter so repeated generations with one seed
 * are identical while different seeds give recognisably different fields.
 * Well identity (ids, ordering) is fixed by kind and ring slot — never by
 * random draw order — so a well can be tracked across seeds, time and runs.
 */

import { mulberry32, seedFromString } from '../rng.js';
import { DEFAULT_WELL_COUNTS, SPATIAL_VERSION } from './params.js';
import type { FieldLayout, Well, WellKind } from './types.js';

export interface WellCountConfig {
  production: number;
  injection: number;
  observation: number;
}

/** Ellipse semi-axes in metres for a reservoir area in km² (5:4 elongation). */
export function boundaryForArea(areaKm2: number): { radiusXM: number; radiusYM: number } {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
    throw new RangeError(`spatial: areaKm2 must be positive, got ${areaKm2}.`);
  }
  // Equal-area ellipse: π·Rx·Ry = A·10⁶ with Rx/Ry = 5/4.
  const areaM2 = areaKm2 * 1e6;
  const radiusXM = Math.sqrt((areaM2 * 5) / (Math.PI * 4));
  const radiusYM = (radiusXM * 4) / 5;
  return { radiusXM, radiusYM };
}

/** Equivalent radius (circle of equal area), metres. Length-scale anchor. */
export function equivalentRadiusM(areaKm2: number): number {
  return Math.sqrt((areaKm2 * 1e6) / Math.PI);
}

function placeRing(
  rng: () => number,
  count: number,
  ringFrac: number,
  boundary: { radiusXM: number; radiusYM: number },
  phase: number,
): { xM: number; yM: number }[] {
  const pts: { xM: number; yM: number }[] = [];
  for (let k = 0; k < count; k++) {
    // Even slots plus bounded jitter: no clustering, no boundary escapes
    // (jitter is radial-inward only, capped at 8% of the ring radius).
    const angle = phase + (k / Math.max(count, 1)) * 2 * Math.PI;
    const inward = 1 - rng() * 0.08;
    const frac = ringFrac * inward;
    pts.push({
      xM: Math.cos(angle) * boundary.radiusXM * frac,
      yM: Math.sin(angle) * boundary.radiusYM * frac,
    });
  }
  return pts;
}

/**
 * Build the demo field layout. Pure and deterministic: same
 * (areaKm2, seed, counts, depthM) always yields the same wells in the same order.
 * Well depth is the static average reservoir depth — plan geometry never
 * invents depths.
 */
export function defaultFieldLayout(
  areaKm2: number,
  seed = 42,
  counts: WellCountConfig = DEFAULT_WELL_COUNTS,
  depthM = 500,
): FieldLayout {
  for (const [name, value] of Object.entries(counts) as [WellKind, number][]) {
    if (!Number.isInteger(value) || value < 0 || value > 12) {
      throw new RangeError(`spatial: ${name} well count must be an integer in [0, 12], got ${value}.`);
    }
  }
  if (!Number.isFinite(depthM) || depthM < 0) {
    throw new RangeError(`spatial: depthM must be >= 0, got ${depthM}.`);
  }
  const boundary = boundaryForArea(areaKm2);
  const rng = mulberry32(seedFromString(`field:${seed}`));
  const wells: Well[] = [];
  const pushWells = (
    kind: WellKind,
    prefix: string,
    positions: { xM: number; yM: number }[],
  ): void => {
    const share = positions.length === 0 ? 0 : 1 / positions.length;
    positions.forEach((p, i) => {
      const id = `${prefix}-${String(i + 1).padStart(2, '0')}`;
      wells.push({
        id,
        name: `${kind === 'production' ? 'Production' : kind === 'injection' ? 'Injection' : 'Observation'} well ${id}`,
        kind,
        xM: p.xM,
        yM: p.yM,
        depthM,
        rateShare: kind === 'observation' ? 0 : share,
        status: kind === 'observation' || share === 0 ? 'shut-in' : 'flowing',
      });
    });
  };
  pushWells('production', 'P', placeRing(rng, counts.production, 0.45, boundary, 0.3));
  pushWells('injection', 'I', placeRing(rng, counts.injection, 0.8, boundary, 1.4));
  pushWells('observation', 'O', [{ xM: 0, yM: 0 }].slice(0, counts.observation));
  return { wells, boundary, areaKm2, seed, layoutVersion: SPATIAL_VERSION };
}
