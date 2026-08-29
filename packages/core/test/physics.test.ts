import { describe, expect, it } from 'vitest';
import { calculateResource, mostLikelyInputs, ModelInputError } from '../src/index.js';
import type { ResourceInputs } from '../src/index.js';

const base = mostLikelyInputs();
const withInput = (overrides: Partial<ResourceInputs>): ResourceInputs => ({ ...base, ...overrides });

describe('calculateResource', () => {
  it('returns every intermediate of the chain', () => {
    const r = calculateResource(base);
    for (const key of [
      'ctKjM3C', 'qrPj', 'qwhPj', 'hwhKjKg', 'hoKjKg', 'swhKjKgK',
      'soKjKgK', 'mwhPg', 'waPj', 'ePj', 'capacityMwe',
    ] as const) {
      expect(Number.isFinite(r[key]), `${key} should be finite`).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(calculateResource(base)).toEqual(calculateResource(base));
  });

  it('produces physically sensible magnitudes for the baseline case', () => {
    const r = calculateResource(base);
    // A rock/water mixture sits between the rock (2500) and liquid water (~4000).
    expect(r.ctKjM3C).toBeGreaterThan(2500);
    expect(r.ctKjM3C).toBeLessThan(4000);
    // Thermal energy in place is of order a thousand PJ for a resource this size.
    expect(r.qrPj).toBeGreaterThan(500);
    expect(r.qrPj).toBeLessThan(5000);
    // Available work must be a fraction of the recovered heat: the second law.
    expect(r.waPj).toBeGreaterThan(0);
    expect(r.waPj).toBeLessThan(r.qwhPj);
    expect(r.ePj).toBeLessThan(r.waPj);
    // A plant of a few tens of MWe for a resource of this size.
    expect(r.capacityMwe).toBeGreaterThan(5);
    expect(r.capacityMwe).toBeLessThan(80);
  });

  it('scales linearly with area, thickness, recovery and utilization', () => {
    const reference = calculateResource(base).capacityMwe;
    for (const field of ['areaKm2', 'thicknessM', 'recoveryFactor', 'utilizationFactor'] as const) {
      const doubled = calculateResource(withInput({ [field]: base[field] * 2 })).capacityMwe;
      expect(doubled / reference, `${field} should scale linearly`).toBeCloseTo(2, 9);
    }
  });

  it('scales inversely with lifetime and capacity factor', () => {
    const reference = calculateResource(base).capacityMwe;
    const doubleLife = calculateResource(withInput({ lifetimeYears: base.lifetimeYears * 2 }));
    // The same energy spread over twice the life gives half the average capacity.
    expect(doubleLife.capacityMwe).toBeCloseTo(reference / 2, 9);
    expect(doubleLife.capacityMwe).toBeLessThan(reference);
    // Capacity factor divides the same way: a plant running less often must be larger
    // to deliver the same energy.
    const halfFactor = calculateResource(withInput({ capacityFactor: base.capacityFactor / 2 }));
    expect(halfFactor.capacityMwe).toBeCloseTo(reference * 2, 9);
  });

  it('increases recovered energy with reservoir temperature', () => {
    let previous = -Infinity;
    for (const temperatureC of [150, 175, 200, 225, 250]) {
      const r = calculateResource(withInput({ temperatureC }));
      expect(r.qwhPj).toBeGreaterThan(previous);
      previous = r.qwhPj;
    }
  });

  it('decreases available work as the ambient temperature rises', () => {
    // A warmer heat sink leaves less exergy in the same produced fluid.
    const cool = calculateResource(withInput({ ambientTemperatureC: 5 }));
    const warm = calculateResource(withInput({ ambientTemperatureC: 25 }));
    expect(warm.waPj).toBeLessThan(cool.waPj);
  });

  it('moves the combined heat capacity towards water as porosity rises', () => {
    const dry = calculateResource(withInput({ porosity: 0.01 })).ctKjM3C;
    const wet = calculateResource(withInput({ porosity: 0.3 })).ctKjM3C;
    // Liquid water at reservoir temperature stores more heat per m3 than the rock
    // (rho ~840 x cp ~4.6 = ~3900 vs 2500), so a more porous reservoir holds more.
    expect(wet).toBeGreaterThan(dry);
    // The mixture always stays between the two end members.
    expect(wet).toBeLessThan(4200);
    expect(dry).toBeGreaterThan(base.rockHeatCapacityKjM3C);
  });
});

describe('input validation', () => {
  const invalid: [string, Partial<ResourceInputs>][] = [
    ['negative area', { areaKm2: -1 }],
    ['zero area', { areaKm2: 0 }],
    ['non-positive thickness', { thicknessM: 0 }],
    ['temperature below the domain', { temperatureC: -10 }],
    ['temperature above Region 1', { temperatureC: 400 }],
    ['ambient equal to reservoir temperature', { ambientTemperatureC: base.temperatureC }],
    ['ambient above reservoir temperature', { ambientTemperatureC: 300 }],
    ['recovery factor above 1', { recoveryFactor: 1.5 }],
    ['recovery factor at 0', { recoveryFactor: 0 }],
    ['utilization factor above 1', { utilizationFactor: 2 }],
    ['porosity at 1', { porosity: 1 }],
    ['negative depth', { depthM: -50 }],
    ['capacity factor above 1', { capacityFactor: 1.2 }],
    ['negative lifetime', { lifetimeYears: -25 }],
    ['NaN area', { areaKm2: NaN }],
  ];

  for (const [name, overrides] of invalid) {
    it(`rejects ${name}`, () => {
      expect(() => calculateResource(withInput(overrides))).toThrow(ModelInputError);
    });
  }

  it('names the offending field on the error', () => {
    try {
      calculateResource(withInput({ areaKm2: -1 }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ModelInputError).field).toBe('areaKm2');
    }
  });
});
