import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPATIAL_PARAMS,
  SPATIAL_VERSION,
  assertValidSpatialParams,
  boundaryForArea,
  conditionsSeries,
  defaultFieldLayout,
  equivalentRadiusM,
  fieldGrid,
  layoutWellById,
  observeWells,
  wellById,
  wellConditions,
  wellRates,
  wellStream,
  type FieldLayout,
  type SpatialParams,
  type WellConditions,
} from '../src/spatial/index.js';

const PARAMS: SpatialParams = { ...DEFAULT_SPATIAL_PARAMS };
const LAYOUT = defaultFieldLayout(4, 42, undefined, 500);
const BULK = { temperatureC: 220, pressureBar: 40 };
const RATES = { productionKgS: 80, injectionKgS: 56 };

function customLayout(): FieldLayout {
  return {
    wells: [
      { id: 'P-01', name: 'P-01', kind: 'production', xM: -200, yM: 0, depthM: 500, rateShare: 1, status: 'flowing' },
      { id: 'I-01', name: 'I-01', kind: 'injection', xM: 600, yM: 0, depthM: 500, rateShare: 1, status: 'flowing' },
    ],
    boundary: { radiusXM: 1200, radiusYM: 960 },
    areaKm2: 3.62,
    seed: 7,
    layoutVersion: SPATIAL_VERSION,
  };
}

describe('defaultFieldLayout', () => {
  it('keeps every well inside the boundary ellipse', () => {
    for (const w of LAYOUT.wells) {
      const r = (w.xM / LAYOUT.boundary.radiusXM) ** 2 + (w.yM / LAYOUT.boundary.radiusYM) ** 2;
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('derives an equal-area footprint from the reservoir area', () => {
    const { radiusXM, radiusYM } = boundaryForArea(4);
    expect(Math.PI * radiusXM * radiusYM).toBeCloseTo(4e6, 6);
    expect(radiusXM / radiusYM).toBeCloseTo(5 / 4, 12);
    expect(equivalentRadiusM(4)).toBeCloseTo(Math.sqrt(4e6 / Math.PI), 9);
  });

  it('is deterministic per seed with stable well identity', () => {
    const again = defaultFieldLayout(4, 42, undefined, 500);
    expect(again).toEqual(LAYOUT);
    expect(LAYOUT.wells.map((w) => w.id)).toEqual([
      'P-01', 'P-02', 'P-03', 'P-04', 'I-01', 'I-02', 'I-03', 'O-01',
    ]);
    const other = defaultFieldLayout(4, 43, undefined, 500);
    expect(other.wells.map((w) => w.id)).toEqual(LAYOUT.wells.map((w) => w.id));
    const moved = other.wells.some((w, i) => w.xM !== LAYOUT.wells[i]!.xM);
    expect(moved).toBe(true);
  });

  it('scales the footprint with area and splits rate shares within kind', () => {
    const big = defaultFieldLayout(9, 42, undefined, 500);
    expect(big.boundary.radiusXM).toBeGreaterThan(LAYOUT.boundary.radiusXM);
    const prodShare = LAYOUT.wells.filter((w) => w.kind === 'production')
      .reduce((a, w) => a + w.rateShare, 0);
    const injShare = LAYOUT.wells.filter((w) => w.kind === 'injection')
      .reduce((a, w) => a + w.rateShare, 0);
    expect(prodShare).toBeCloseTo(1, 12);
    expect(injShare).toBeCloseTo(1, 12);
    const obs = LAYOUT.wells.find((w) => w.kind === 'observation')!;
    expect(obs.rateShare).toBe(0);
    expect(obs.status).toBe('shut-in');
    for (const w of LAYOUT.wells) expect(w.depthM).toBe(500);
  });

  it('rejects invalid geometry loudly', () => {
    expect(() => boundaryForArea(0)).toThrow(RangeError);
    expect(() => boundaryForArea(-3)).toThrow(RangeError);
    expect(() => defaultFieldLayout(4, 42, { production: -1, injection: 0, observation: 0 })).toThrow(RangeError);
    expect(() => defaultFieldLayout(4, 42, undefined, -10)).toThrow(RangeError);
    expect(() => layoutWellById(LAYOUT, 'X-99')).toThrow(RangeError);
  });
});

describe('wellRates', () => {
  it('splits field totals by share and sums back exactly', () => {
    const rates = wellRates(LAYOUT, 80, 56);
    const prodSum = LAYOUT.wells.filter((w) => w.kind === 'production')
      .reduce((a, w) => a + rates.get(w.id)!, 0);
    const injSum = LAYOUT.wells.filter((w) => w.kind === 'injection')
      .reduce((a, w) => a + rates.get(w.id)!, 0);
    expect(prodSum).toBeCloseTo(80, 9);
    expect(injSum).toBeCloseTo(56, 9);
  });

  it('rejects negative rates loudly', () => {
    expect(() => wellRates(LAYOUT, -1, 56)).toThrow(RangeError);
    expect(() => wellRates(LAYOUT, 80, NaN)).toThrow(RangeError);
  });
});

describe('wellConditions', () => {
  it('reads bulk conditions exactly when nothing flows', () => {
    const conds = wellConditions(BULK, LAYOUT, { productionKgS: 0, injectionKgS: 0 }, 60, PARAMS, 0);
    for (const c of conds) {
      const w = layoutWellById(LAYOUT, c.wellId);
      // Injectors carry injection-temperature water downhole by design.
      expect(c.temperatureC).toBe(w.kind === 'injection' ? 60 : BULK.temperatureC);
      expect(c.pressureBar).toBe(BULK.pressureBar);
      expect(c.pressureLimited).toBe(false);
      expect(c.rateKgS).toBe(0);
    }
  });

  it('draws producers down and mounds injectors up', () => {
    const conds = wellConditions(BULK, LAYOUT, RATES, 60, PARAMS, 1);
    for (const c of conds) {
      const w = layoutWellById(LAYOUT, c.wellId);
      if (w.kind === 'production') expect(c.pressureBar).toBeLessThan(BULK.pressureBar);
      if (w.kind === 'observation') {
        // No own rate: only interference, bounded by the full cone sum.
        expect(Math.abs(c.pressureBar - BULK.pressureBar)).toBeLessThan(
          PARAMS.drawdownPerRate * (RATES.productionKgS + RATES.injectionKgS),
        );
      }
      expect(c.pressureLimited).toBe(false);
    }
    // Injectors-only field: support raises every well above bulk.
    const onlyInj = wellConditions(BULK, LAYOUT, { productionKgS: 0, injectionKgS: 56 }, 60, PARAMS, 1);
    for (const c of onlyInj) expect(c.pressureBar).toBeGreaterThan(BULK.pressureBar);
  });

  it('cools producers boundedly toward injection temperature', () => {
    const conds = wellConditions(BULK, customLayout(), RATES, 60, PARAMS, 1);
    const p = wellById(conds, 'P-01');
    expect(p.temperatureC).toBeLessThan(BULK.temperatureC);
    expect(p.temperatureC).toBeGreaterThan(60);
    // Cooling shrinks with distance: move the injector twice as far.
    const far: FieldLayout = {
      ...customLayout(),
      wells: customLayout().wells.map((w) => (w.id === 'I-01' ? { ...w, xM: 1000 } : w)),
    };
    const pFar = wellById(wellConditions(BULK, far, RATES, 60, PARAMS, 1), 'P-01');
    expect(pFar.temperatureC).toBeGreaterThan(p.temperatureC);
  });

  it('reports injection temperature at injectors and bulk at observation wells', () => {
    const conds = wellConditions(BULK, customLayout(), RATES, 60, PARAMS, 1);
    expect(wellById(conds, 'I-01').temperatureC).toBe(60);
  });

  it('is monotone in rate and never mutates its inputs', () => {
    const before = JSON.stringify(LAYOUT);
    const low = wellById(wellConditions(BULK, customLayout(), { productionKgS: 20, injectionKgS: 0 }, 60, PARAMS, 1), 'P-01');
    const high = wellById(wellConditions(BULK, customLayout(), { productionKgS: 80, injectionKgS: 0 }, 60, PARAMS, 1), 'P-01');
    expect(high.pressureBar).toBeLessThan(low.pressureBar);
    expect(JSON.stringify(LAYOUT)).toBe(before);
  });

  it('flags (never hides) extreme drawdown at the plausibility floor', () => {
    const hot: SpatialParams = { ...PARAMS, drawdownPerRate: 50 };
    const conds = wellConditions(BULK, customLayout(), RATES, 60, hot, 1);
    const p = wellById(conds, 'P-01');
    expect(p.pressureBar).toBe(0.5);
    expect(p.pressureLimited).toBe(true);
  });

  it('rejects bad params loudly', () => {
    expect(() => assertValidSpatialParams({ ...PARAMS, drawdownPerRate: -1 })).toThrow(RangeError);
    expect(() => wellConditions(BULK, LAYOUT, RATES, 60, { ...PARAMS, coolingFraction: 5 }, 1)).toThrow(RangeError);
    expect(() => wellById([], 'P-01')).toThrow(RangeError);
  });
});

describe('fieldGrid', () => {
  it('marks outside cells and agrees with wells nearby', () => {
    const cells = fieldGrid(BULK, LAYOUT, RATES, 60, PARAMS, 25, 25);
    expect(cells.length).toBe(625);
    const inside = cells.filter((c) => c.inside);
    expect(inside.length).toBeGreaterThan(300);
    for (const c of cells) {
      if (!c.inside) {
        expect(c.temperatureC).toBeNaN();
      } else {
        expect(Number.isFinite(c.temperatureC)).toBe(true);
        expect(Number.isFinite(c.pressureBar)).toBe(true);
      }
    }
    // Smoothness bound: Lipschitz C_q·Q_tot/L times half the cell diagonal.
    const rEq = equivalentRadiusM(LAYOUT.areaKm2);
    const lenP = PARAMS.influenceLengthFrac * rEq;
    const dx = (2 * LAYOUT.boundary.radiusXM) / 24;
    const dy = (2 * LAYOUT.boundary.radiusYM) / 24;
    const bound = (PARAMS.drawdownPerRate * (RATES.productionKgS + RATES.injectionKgS) / lenP) *
      Math.hypot(dx, dy) / 2 + 1e-9;
    const conds = wellConditions(BULK, LAYOUT, RATES, 60, PARAMS, 1);
    for (const wc of conds) {
      const w = layoutWellById(LAYOUT, wc.wellId);
      let nearest = Number.POSITIVE_INFINITY;
      let nearestP = 0;
      for (const c of inside) {
        const d = Math.hypot(c.xM - w.xM, c.yM - w.yM);
        if (d < nearest) {
          nearest = d;
          nearestP = c.pressureBar;
        }
      }
      expect(Math.abs(nearestP - wc.pressureBar)).toBeLessThanOrEqual(
        (PARAMS.drawdownPerRate * (RATES.productionKgS + RATES.injectionKgS) / lenP) * nearest + 1e-9,
      );
    }
    expect(bound).toBeGreaterThan(0);
  });

  it('rejects invalid grids loudly', () => {
    expect(() => fieldGrid(BULK, LAYOUT, RATES, 60, PARAMS, 1, 25)).toThrow(RangeError);
    expect(() => fieldGrid(BULK, LAYOUT, RATES, 60, PARAMS, 25, 500)).toThrow(RangeError);
  });
});

describe('observeWells', () => {
  const truth: WellConditions[] = wellConditions(BULK, LAYOUT, RATES, 60, PARAMS, 0);
  const sensors = {
    temperatureC: { sigma: 1.5, bias: 0, dropoutRate: 0.01 },
    pressureBar: { sigma: 0.8, bias: 0, dropoutRate: 0.01 },
  };

  it('reproduces truth exactly with perfect sensors', () => {
    const perfect = {
      temperatureC: { sigma: 0, bias: 0, dropoutRate: 0 },
      pressureBar: { sigma: 0, bias: 0, dropoutRate: 0 },
    };
    const obs = observeWells(LAYOUT.wells, truth, perfect, 42, 7, 0.5);
    expect(obs.length).toBe(LAYOUT.wells.length * 2);
    for (const o of obs) {
      expect(o.quality).toBe('ok');
      expect(o.observedValue).toBe(o.trueValue);
      expect(o.residual).toBe(0);
      expect(o.timeYears).toBe(0.5);
    }
  });

  it('is reproducible per step and isolated per well', () => {
    const a = observeWells(LAYOUT.wells, truth, sensors, 42, 5, 0.4);
    const b = observeWells(LAYOUT.wells, truth, sensors, 42, 5, 0.4);
    expect(a).toEqual(b);
    // Observing one well alone gives it identical readings (own stream).
    const solo = observeWells([LAYOUT.wells[0]!], truth, sensors, 42, 5, 0.4);
    expect(solo).toEqual(a.filter((o) => o.wellId === LAYOUT.wells[0]!.id));
    // Step index selects independent draws: step 5 alone equals step 5 of a run.
    const c = observeWells(LAYOUT.wells, truth, sensors, 99, 5, 0.4);
    expect(c).not.toEqual(a);
  });

  it('flags gaps explicitly with units and kind attached', () => {
    const gappy = {
      temperatureC: { sigma: 1.5, bias: 0, dropoutRate: 0.6 },
      pressureBar: { sigma: 0.8, bias: 0, dropoutRate: 0.0 },
    };
    const obs = observeWells(LAYOUT.wells, truth, gappy, 3, 2, 0.16);
    const missing = obs.filter((o) => o.quality === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    for (const o of missing) {
      expect(o.observedValue).toBeNull();
      expect(o.reason).toBe('dropout');
      expect(o.unit).toBe('°C');
    }
    // Same well stream helper is deterministic.
    expect(wellStream(3, 'P-01', 'temperatureC', 2)()).toBe(wellStream(3, 'P-01', 'temperatureC', 2)());
  });

  it('never mutates its inputs and rejects bad config loudly', () => {
    const before = JSON.stringify({ wells: LAYOUT.wells, truth });
    observeWells(LAYOUT.wells, truth, sensors, 42, 5, 0.4);
    expect(JSON.stringify({ wells: LAYOUT.wells, truth })).toBe(before);
    expect(() => observeWells(LAYOUT.wells, truth, sensors, 42, -1, 0)).toThrow(RangeError);
    expect(() =>
      observeWells(LAYOUT.wells, truth, { ...sensors, temperatureC: { sigma: -1, bias: 0, dropoutRate: 0 } }, 42, 0, 0),
    ).toThrow(RangeError);
    expect(() => observeWells(LAYOUT.wells, truth.slice(1), sensors, 42, 0, 0)).toThrow(RangeError);
  });
});

describe('spatial params', () => {
  it('carries a semver version', () => {
    expect(SPATIAL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('conditionsSeries', () => {
  const states = [0, 1, 2].map((s) => ({
    temperatureC: 220 - s,
    pressureBar: 40 - s * 0.5,
    timeYears: s / 12,
  }));
  const controlsAt = (_s: number) => ({ productionKgS: 80, injectionKgS: 56, injectionTemperatureC: 60 });

  it('maps each state to well conditions in order', () => {
    const series = conditionsSeries(states, LAYOUT, controlsAt, PARAMS);
    expect(series.length).toBe(3);
    expect(series[1]!).toEqual(
      wellConditions({ temperatureC: 219, pressureBar: 39.5 }, LAYOUT, RATES, 60, PARAMS, 1 / 12),
    );
    expect(series[2]![0]!.timeYears).toBeCloseTo(2 / 12, 12);
  });

  it('never mutates its inputs', () => {
    const before = JSON.stringify(states);
    conditionsSeries(states, LAYOUT, controlsAt, PARAMS);
    expect(JSON.stringify(states)).toBe(before);
  });
});
