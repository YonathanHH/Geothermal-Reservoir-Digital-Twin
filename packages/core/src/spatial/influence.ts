/**
 * Bulk-to-local influence mapping (Phase 3).
 *
 * Each well's conditions are the tank bulk state plus steady, superposed
 * exponential cones from every flowing well:
 *
 *   p_i = p_tank − C_q·[q_i + Σ_{j≠i} q_j·e^(−d_ij/L)] + C_q·Σ_k q^inj_k·e^(−d_ik/L)
 *   T_i = T_tank − (T_tank − T_inj)·c·min(1, Σ_k f_k·e^(−d_ik/L_T))   (producers)
 *   T_i = T_inj                                                        (injectors)
 *   T_i = T_tank                                                       (observation)
 *
 * Producers draw down (own rate plus interference from neighbours);
 * injectors mound pressure back up; nearby injectors drag producer
 * temperatures a bounded fraction toward injection temperature. Observation
 * wells carry no rate and read bulk conditions exactly. Rates below are
 * signed withdrawal-positive for producers, injection-positive for injectors.
 * Pure functions of (bulk, layout, rates) — no memory, no feedback into the
 * tank. See MODEL_SPEC §14.
 */

import type { FieldCell, FieldLayout, SpatialParams, Well, WellConditions } from './types.js';
import { assertValidSpatialParams } from './params.js';
import { equivalentRadiusM } from './layout.js';

/** Pressure below which a well reading is clamped and flagged, bar. */
export const PRESSURE_FLOOR_BAR = 0.5;

function distanceM(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Field rates split onto wells: per-well signed withdrawal, kg/s. */
export function wellRates(
  layout: FieldLayout,
  productionKgS: number,
  injectionKgS: number,
): Map<string, number> {
  if (!Number.isFinite(productionKgS) || productionKgS < 0) {
    throw new RangeError(`spatial: productionKgS must be >= 0, got ${productionKgS}.`);
  }
  if (!Number.isFinite(injectionKgS) || injectionKgS < 0) {
    throw new RangeError(`spatial: injectionKgS must be >= 0, got ${injectionKgS}.`);
  }
  const rates = new Map<string, number>();
  for (const w of layout.wells) {
    if (w.kind === 'production') rates.set(w.id, w.rateShare * productionKgS);
    else if (w.kind === 'injection') rates.set(w.id, w.rateShare * injectionKgS);
    else rates.set(w.id, 0);
  }
  return rates;
}

export interface BulkConditions {
  temperatureC: number;
  pressureBar: number;
}

export interface FieldRates {
  productionKgS: number;
  injectionKgS: number;
}

/**
 * True local conditions at every well. Never mutates its inputs.
 *
 * @throws {RangeError} on non-finite bulk state or invalid spatial params.
 */
export function wellConditions(
  bulk: BulkConditions,
  layout: FieldLayout,
  rates: FieldRates,
  injectionTemperatureC: number,
  params: SpatialParams,
  timeYears: number,
): WellConditions[] {
  assertValidSpatialParams(params);
  for (const [name, value] of [
    ['bulk.temperatureC', bulk.temperatureC],
    ['bulk.pressureBar', bulk.pressureBar],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`spatial: ${name} must be finite, got ${value}.`);
  }
  if (!Number.isFinite(injectionTemperatureC)) {
    throw new RangeError(`spatial: injectionTemperatureC must be finite, got ${injectionTemperatureC}.`);
  }
  const perWell = wellRates(layout, rates.productionKgS, rates.injectionKgS);
  const rEq = equivalentRadiusM(layout.areaKm2);
  const lenP = params.influenceLengthFrac * rEq;
  const lenT = params.thermalLengthFrac * rEq;
  const injectors = layout.wells.filter((w) => w.kind === 'injection');

  return layout.wells.map((w) => {
    const ownRate = perWell.get(w.id) ?? 0;
    let drawdown = 0;
    // Own withdrawal plus interference cones from every other flowing well.
    for (const other of layout.wells) {
      if (other.id === w.id) continue;
      const q = perWell.get(other.id) ?? 0;
      if (q === 0) continue;
      const signed = other.kind === 'injection' ? -q : q;
      drawdown += signed * Math.exp(-distanceM(w.xM, w.yM, other.xM, other.yM) / lenP);
    }
    drawdown += w.kind === 'injection' ? -ownRate : ownRate;
    let pressureBar = bulk.pressureBar - params.drawdownPerRate * drawdown;
    let pressureLimited = false;
    if (!(pressureBar > PRESSURE_FLOOR_BAR)) {
      pressureBar = PRESSURE_FLOOR_BAR;
      pressureLimited = true;
    }

    let temperatureC: number;
    if (w.kind === 'injection') {
      temperatureC = injectionTemperatureC;
    } else if (w.kind === 'observation' || injectors.length === 0) {
      temperatureC = bulk.temperatureC;
    } else {
      // Bounded thermal pull toward injection temperature, weighted by each
      // injector's rate share decayed with distance. Observation wells and
      // injector-free fields read bulk temperature exactly.
      const totalInj = injectors.reduce((a, k) => a + (perWell.get(k.id) ?? 0), 0);
      let pull = 0;
      if (totalInj > 0) {
        for (const k of injectors) {
          pull +=
            ((perWell.get(k.id) ?? 0) / totalInj) *
            Math.exp(-distanceM(w.xM, w.yM, k.xM, k.yM) / lenT);
        }
      }
      const frac = params.coolingFraction * Math.min(1, pull);
      temperatureC = bulk.temperatureC - (bulk.temperatureC - injectionTemperatureC) * frac;
    }

    return {
      wellId: w.id,
      timeYears,
      temperatureC,
      pressureBar,
      rateKgS: ownRate,
      pressureLimited,
    };
  });
}

/**
 * Gridded T/p field for heatmap rendering, evaluated with the same cones the
 * wells use (each cell sees every flowing well). `nx × ny` cells span the
 * boundary ellipse's bounding box; cells outside report `inside: false`.
 */
export function fieldGrid(
  bulk: BulkConditions,
  layout: FieldLayout,
  rates: FieldRates,
  injectionTemperatureC: number,
  params: SpatialParams,
  nx: number,
  ny: number,
): FieldCell[] {
  assertValidSpatialParams(params);
  if (!Number.isInteger(nx) || nx < 2 || nx > 101 || !Number.isInteger(ny) || ny < 2 || ny > 101) {
    throw new RangeError(`spatial: grid must be 2–101 per side, got ${nx}×${ny}.`);
  }
  const { radiusXM, radiusYM } = layout.boundary;
  const perWell = wellRates(layout, rates.productionKgS, rates.injectionKgS);
  const flowing = layout.wells.filter((w) => (perWell.get(w.id) ?? 0) > 0);
  const injectors = flowing.filter((w) => w.kind === 'injection');
  const totalInj = injectors.reduce((a, w) => a + (perWell.get(w.id) ?? 0), 0);
  const rEq = equivalentRadiusM(layout.areaKm2);
  const lenP = params.influenceLengthFrac * rEq;
  const lenT = params.thermalLengthFrac * rEq;
  const cells: FieldCell[] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const xM = -radiusXM + ((2 * radiusXM * ix) / (nx - 1));
      const yM = -radiusYM + ((2 * radiusYM * iy) / (ny - 1));
      const inside = (xM / radiusXM) ** 2 + (yM / radiusYM) ** 2 <= 1;
      if (!inside) {
        cells.push({ xM, yM, inside, temperatureC: NaN, pressureBar: NaN });
        continue;
      }
      let drawdown = 0;
      let pull = 0;
      for (const w of flowing) {
        const q = perWell.get(w.id) ?? 0;
        const decay = Math.exp(-distanceM(xM, yM, w.xM, w.yM) / lenP);
        drawdown += (w.kind === 'injection' ? -q : q) * decay;
        if (w.kind === 'injection' && totalInj > 0) {
          pull += (q / totalInj) * Math.exp(-distanceM(xM, yM, w.xM, w.yM) / lenT);
        }
      }
      const pressureBar = Math.max(bulk.pressureBar - params.drawdownPerRate * drawdown, PRESSURE_FLOOR_BAR);
      const frac = params.coolingFraction * Math.min(1, pull);
      const temperatureC = bulk.temperatureC - (bulk.temperatureC - injectionTemperatureC) * frac;
      cells.push({ xM, yM, inside, temperatureC, pressureBar });
    }
  }
  return cells;
}

/** Look up one well's conditions by id (throws on unknown id). */
export function wellById(conditions: WellConditions[], wellId: string): WellConditions {
  const found = conditions.find((c) => c.wellId === wellId);
  if (!found) throw new RangeError(`spatial: unknown well id '${wellId}'.`);
  return found;
}

/** Look up one well's layout entry by id (throws on unknown id). */
export function layoutWellById(layout: FieldLayout, wellId: string): Well {
  const found = layout.wells.find((w) => w.id === wellId);
  if (!found) throw new RangeError(`spatial: unknown well id '${wellId}'.`);
  return found;
}

/** Minimal bulk-state view: anything with a temperature, pressure and clock. */
export interface BulkStateLike {
  temperatureC: number;
  pressureBar: number;
  timeYears: number;
}

/**
 * Map a whole recorded trajectory onto per-step well conditions — the tested
 * bridge between twin trajectories (truth or posterior mean) and the map.
 * Returns one array per input state, in order; never mutates its inputs.
 */
export function conditionsSeries(
  states: readonly BulkStateLike[],
  layout: FieldLayout,
  controlsAt: (stepIndex: number) => { productionKgS: number; injectionKgS: number; injectionTemperatureC: number },
  params: SpatialParams,
): WellConditions[][] {
  assertValidSpatialParams(params);
  return states.map((s, stepIndex) => {
    const controls = controlsAt(stepIndex);
    return wellConditions(
      { temperatureC: s.temperatureC, pressureBar: s.pressureBar },
      layout,
      { productionKgS: controls.productionKgS, injectionKgS: controls.injectionKgS },
      controls.injectionTemperatureC,
      params,
      s.timeYears,
    );
  });
}
