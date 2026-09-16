/**
 * Stochastic Ensemble Kalman Filter analysis (Phase 2).
 *
 * One cycle: given N forecast vectors xⱼ = [T, p, M] and up to two wellhead
 * observations (temperature, pressure, each with its sensor sigma), compute
 * posterior vectors via perturbed observations:
 *
 *   Dⱼ = y + εⱼ,   εⱼ ∼ N(0, R)          (fresh deterministic stream per cycle)
 *   K  = P_xy · (P_yy + R)⁻¹              (sample covariances, R diagonal)
 *   xⱼᵃ = xⱼᶠ + K · (Dⱼ − H xⱼᶠ)            (H picks the observed rows)
 *
 * Missing readings contribute no row: with nothing usable the forecast passes
 * through untouched. Zero-noise (σ = 0) observations are valid: perturbed
 * observations then equal the reading exactly and the gain trusts them fully.
 * Pure apart from advancing `rng`.
 */

import { mulberry32, seedFromString, type Rng } from '../rng.js';
import { gaussianSample } from '../telemetry/sensors.js';
import { STATE_DIM, type AssimilatedObservation, type EnkfAnalysis, type StateVector } from './types.js';
import { crossCovariance, invertSymmetric, matMul } from './linalg.js';

/** Deterministic filter-noise stream for one cycle: isolated from all others. */
export function enkfStream(seed: number, cycle: number): Rng {
  return mulberry32(seedFromString(`${seed}:enkf:${cycle}`));
}

/** Row of H for a channel: temperature → state row 0, pressure → row 1. */
function observationRow(channel: AssimilatedObservation['channel']): number {
  return channel === 'temperatureC' ? 0 : 1;
}

/**
 * Run one analysis. Forecast vectors are never mutated; the posterior is fresh.
 *
 * @throws {RangeError} on empty ensemble, non-finite inputs, negative
 * sigmas, or a non-invertible innovation covariance (collapsed ensemble).
 */
export function enkfAnalysis(
  forecast: readonly StateVector[],
  observations: readonly AssimilatedObservation[],
  rng: Rng,
  inflation = 1,
): EnkfAnalysis {
  const n = forecast.length;
  if (n < 2) throw new RangeError(`enkf: need at least 2 members, got ${n}.`);
  if (!(inflation >= 1)) throw new RangeError(`enkf: inflation must be >= 1, got ${inflation}.`);
  for (const [j, x] of forecast.entries()) {
    if (x.length !== STATE_DIM || x.some((v) => !Number.isFinite(v))) {
      throw new RangeError(`enkf: forecast member ${j} is not a finite ${STATE_DIM}-vector.`);
    }
  }
  for (const [k, o] of observations.entries()) {
    if (!Number.isFinite(o.value)) throw new RangeError(`enkf: observation ${k} value is not finite.`);
    if (!Number.isFinite(o.sigma) || o.sigma < 0) {
      throw new RangeError(`enkf: observation ${k} sigma must be >= 0, got ${o.sigma}.`);
    }
  }

  const channelsUsed = observations.map((o) => o.channel);
  if (observations.length === 0) {
    return {
      posterior: forecast.map((x) => [...x] as StateVector),
      gain: [],
      channelsUsed,
    };
  }

  // Forecast observation ensemble: identity rows (wellhead T/p observe state).
  const yPred: number[][] = forecast.map((x) =>
    observations.map((o) => x[observationRow(o.channel)]!),
  );
  // Perturbed observations, one noise draw per member per channel.
  const perturbed: number[][] = forecast.map(() =>
    observations.map((o) => o.value + gaussianSample(rng) * o.sigma),
  );
  // Innovations.
  const innov: number[][] = perturbed.map((d, j) => d.map((v, k) => v - yPred[j]![k]!));

  // Sample covariances with optional multiplicative inflation of the state.
  const inflated: number[][] =
    inflation === 1
      ? forecast.map((x) => [...x])
      : (() => {
          const means = forecast[0]!.map((_, d) => forecast.reduce((a, x) => a + x[d]!, 0) / n);
          return forecast.map((x) => x.map((v, d) => means[d]! + (v - means[d]!) * Math.sqrt(inflation)));
        })();
  const pxy = crossCovariance(inflated, yPred); // STATE_DIM × m
  const pyy = crossCovariance(yPred, yPred); // m × m
  for (const [k, o] of observations.entries()) pyy[k]![k]! += o.sigma * o.sigma;
  const gain = matMul(pxy, invertSymmetric(pyy)); // STATE_DIM × m

  const posterior: StateVector[] = forecast.map((x, j) => {
    const update = matMul(gain, innov[j]!.map((v) => [v]));
    return [x[0]! + update[0]![0]!, x[1]! + update[1]![0]!, x[2]! + update[2]![0]!] as StateVector;
  });

  return { posterior, gain, channelsUsed };
}
