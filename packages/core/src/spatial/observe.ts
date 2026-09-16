/**
 * Wellhead surveillance observations (Phase 3).
 *
 * The plant bulk meters keep feeding the existing EnKF untouched; these
 * per-well readings are the surveillance layer the map displays. Same sensor
 * conventions as telemetry (Gaussian noise, bias, dropouts, plausibility
 * refusal), own isolated streams `seed:well:{wellId}:{channel}` — retuning
 * one well never reshuffles another, and well streams can never collide with
 * bulk `seed:obs:{channel}:{index}` streams. Only temperature and pressure
 * are metered: rates are known controls, not measurements.
 */

import { mulberry32, seedFromString, type Rng } from '../rng.js';
import { REGION1_MAX_C, REGION1_MIN_C } from '../steam/index.js';
import { gaussianSample } from '../telemetry/sensors.js';
import type { SensorConfig } from '../telemetry/types.js';
import type { WellConditions, WellObservation } from './types.js';
import type { Well } from './types.js';

/** One well's surveillance stream: independent per well, channel and step. */
export function wellStream(
  seed: number,
  wellId: string,
  channel: 'temperatureC' | 'pressureBar',
  stepIndex: number,
): Rng {
  return mulberry32(seedFromString(`${seed}:well:${wellId}:${channel}:${stepIndex}`));
}

/**
 * Observe every well's true conditions once. Pure apart from advancing the
 * per-well streams; never mutates its inputs. Failures become flags, never
 * exceptions.
 */
export function observeWells(
  wells: readonly Well[],
  truth: readonly WellConditions[],
  sensors: { temperatureC: SensorConfig; pressureBar: SensorConfig },
  seed: number,
  stepIndex: number,
  timeYears: number,
): WellObservation[] {
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    throw new RangeError(`spatial: stepIndex must be >= 0, got ${stepIndex}.`);
  }
  const byId = new Map(truth.map((c) => [c.wellId, c]));
  const out: WellObservation[] = [];
  for (const w of wells) {
    const conditions = byId.get(w.id);
    if (!conditions) throw new RangeError(`spatial: no conditions for well '${w.id}'.`);
    for (const channel of ['temperatureC', 'pressureBar'] as const) {
      const sensor = sensors[channel];
      if (!Number.isFinite(sensor.sigma) || sensor.sigma < 0) {
        throw new RangeError(`spatial: ${channel}.sigma must be >= 0, got ${sensor.sigma}.`);
      }
      if (!Number.isFinite(sensor.dropoutRate) || sensor.dropoutRate < 0 || sensor.dropoutRate >= 1) {
        throw new RangeError(
          `spatial: ${channel}.dropoutRate must lie in [0, 1), got ${sensor.dropoutRate}.`,
        );
      }
      const rng = wellStream(seed, w.id, channel, stepIndex);
      const trueValue = channel === 'temperatureC' ? conditions.temperatureC : conditions.pressureBar;
      const base = {
        wellId: w.id,
        kind: w.kind,
        timeYears,
        stepIndex,
        channel,
        unit: channel === 'temperatureC' ? '°C' : 'bar',
        trueValue,
      };
      if (rng() < sensor.dropoutRate) {
        out.push({ ...base, observedValue: null, residual: null, quality: 'missing', reason: 'dropout' });
        continue;
      }
      const observedValue = trueValue + sensor.bias + gaussianSample(rng) * sensor.sigma;
      const lo = channel === 'temperatureC' ? REGION1_MIN_C : 0;
      const hi = channel === 'temperatureC' ? REGION1_MAX_C : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(observedValue) || observedValue < lo || observedValue > hi) {
        out.push({ ...base, observedValue: null, residual: null, quality: 'rejected', reason: 'out-of-range' });
      } else {
        out.push({
          ...base,
          observedValue,
          residual: observedValue - trueValue,
          quality: 'ok',
          reason: null,
        });
      }
    }
  }
  return out;
}
