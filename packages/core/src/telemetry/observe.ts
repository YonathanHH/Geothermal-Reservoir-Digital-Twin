/**
 * Observation layer: hidden state → synthetic sensor readings (Phase 1.5).
 *
 * `observeTrajectory` walks a recorded trajectory and emits one
 * `TelemetryPoint` per channel per sampled step. The reservoir is never
 * touched: inputs are read-only, the dynamics keep running (or rather, have
 * already run — telemetry is a pure view over recorded states), and failures
 * are recorded as quality flags rather than thrown.
 *
 * Truth mapping (documented simplifications, see ASSUMPTIONS.md §12):
 * - temperature/pressure channels report the tank's bulk T/p. No wellbore
 *   hydraulics or spatial gradients are resolved; the sensor is modelled as
 *   observing reservoir conditions directly.
 * - rate channels report the prescribed controls at that step (meters on the
 *   setpoint plus noise — the meter does not know the setpoint exactly).
 * - generation reports the state's instantaneous capacity (plant meter).
 */

import { mulberry32, seedFromString, type Rng } from '../rng.js';
import { REGION1_MAX_C, REGION1_MIN_C } from '../steam/index.js';
import type { DynamicEnsemble } from '../dynamics/ensemble.js';
import { TOTAL_STEPS, controlsAt, type DynamicSchedule } from '../dynamics/schedule.js';
import type { Controls, ReservoirState } from '../dynamics/types.js';
import { assertValidTelemetryConfig } from './params.js';
import { TELEMETRY_VERSION } from './params.js';
import { gaussianSample } from './sensors.js';
import {
  TELEMETRY_CHANNELS,
  TELEMETRY_SOURCES,
  TELEMETRY_UNITS,
  type QualityFlag,
  type ChannelDiagnostics,
  type TelemetryChannel,
  type TelemetryConfig,
  type TelemetryPoint,
  type TelemetryRun,
} from './types.js';

/** Plausibility bounds: a noisy reading outside these is `rejected`, not passed on. */
function plausibleBounds(channel: TelemetryChannel): { lo: number; hi: number } {
  switch (channel) {
    case 'temperatureC':
      return { lo: REGION1_MIN_C, hi: REGION1_MAX_C };
    case 'pressureBar':
      return { lo: 0, hi: Number.POSITIVE_INFINITY };
    case 'productionKgS':
    case 'injectionKgS':
    case 'generationMWe':
      return { lo: 0, hi: Number.POSITIVE_INFINITY };
  }
}

/** Hidden true value of a channel at a state/control pair. Pure. */
export function trueValueOf(
  channel: TelemetryChannel,
  state: ReservoirState,
  controls: Controls,
): number {
  switch (channel) {
    case 'temperatureC':
      return state.temperatureC;
    case 'pressureBar':
      return state.pressureBar;
    case 'productionKgS':
      return controls.productionKgS;
    case 'injectionKgS':
      return controls.injectionKgS;
    case 'generationMWe':
      return state.capacityMweInstant;
  }
}

/** One channel's sensor stream: isolated from every parameter and process stream. */
export function sensorStream(seed: number, channel: TelemetryChannel, trajectoryIndex: number): Rng {
  return mulberry32(seedFromString(`${seed}:obs:${channel}:${trajectoryIndex}`));
}

/**
 * Observe one channel once. Consumes one dropout draw, then (when sampled)
 * two noise draws. Pure apart from advancing `rng`.
 */
function observeChannel(
  rng: Rng,
  channel: TelemetryChannel,
  trueValue: number,
  sigma: number,
  bias: number,
  dropoutRate: number,
  timeYears: number,
  stepIndex: number,
): TelemetryPoint {
  const base = {
    timeYears,
    stepIndex,
    channel,
    source: TELEMETRY_SOURCES[channel],
    unit: TELEMETRY_UNITS[channel],
    trueValue,
  };
  if (rng() < dropoutRate) {
    return { ...base, observedValue: null, residual: null, quality: 'missing', reason: 'dropout' };
  }
  const observedValue = trueValue + bias + gaussianSample(rng) * sigma;
  const { lo, hi } = plausibleBounds(channel);
  let quality: QualityFlag = 'ok';
  let reason: string | null = null;
  // Strict inequalities: a reading of exactly 0 (idle rate, zero generation)
  // is legitimate; only values outside the plausible interval are refused.
  if (!Number.isFinite(observedValue) || observedValue < lo || observedValue > hi) {
    quality = 'rejected';
    reason = 'out-of-range';
  }
  return {
    ...base,
    observedValue: quality === 'ok' ? observedValue : null,
    residual: quality === 'ok' ? observedValue - trueValue : null,
    quality,
    reason,
  };
}

export interface ObserveTrajectoryInput {
  /** Recorded states; never mutated. */
  states: readonly ReservoirState[];
  /** Controls applied at each step (only rate channels read these). */
  controlsAt: (stepIndex: number) => Controls;
  config?: TelemetryConfig;
  seed?: number;
  /** Selects this trajectory's sensor streams; stable across runs. */
  trajectoryIndex?: number;
  label?: string;
}

/**
 * Generate the full telemetry record for one recorded trajectory.
 *
 * Observes states at indices 0, cadenceSteps, 2·cadenceSteps, … — monthly for
 * the V1 cadence of 1. Throws only on invalid config; observation failures
 * become flags, never exceptions.
 */
export function observeTrajectory(input: ObserveTrajectoryInput): TelemetryRun {
  const {
    states,
    controlsAt,
    seed = 42,
    trajectoryIndex = 0,
    label = 'Synthetic field telemetry',
  } = input;
  const config = input.config ?? {
    cadenceSteps: 1,
    channels: {
      temperatureC: { sigma: 0, bias: 0, dropoutRate: 0 },
      pressureBar: { sigma: 0, bias: 0, dropoutRate: 0 },
      productionKgS: { sigma: 0, bias: 0, dropoutRate: 0 },
      injectionKgS: { sigma: 0, bias: 0, dropoutRate: 0 },
      generationMWe: { sigma: 0, bias: 0, dropoutRate: 0 },
    },
  };
  assertValidTelemetryConfig(config);
  if (!Number.isInteger(trajectoryIndex) || trajectoryIndex < 0) {
    throw new RangeError(`observeTrajectory: trajectoryIndex must be >= 0, got ${trajectoryIndex}.`);
  }

  const streams = Object.fromEntries(
    TELEMETRY_CHANNELS.map((channel) => [channel, sensorStream(seed, channel, trajectoryIndex)]),
  ) as Record<TelemetryChannel, Rng>;

  const points: TelemetryPoint[] = [];
  for (let s = 0; s < states.length; s++) {
    if (s % config.cadenceSteps !== 0) continue;
    const state = states[s]!;
    const controls = controlsAt(s);
    for (const channel of TELEMETRY_CHANNELS) {
      const sensor = config.channels[channel];
      points.push(
        observeChannel(
          streams[channel],
          channel,
          trueValueOf(channel, state, controls),
          sensor.sigma,
          sensor.bias,
          sensor.dropoutRate,
          state.timeYears,
          s,
        ),
      );
    }
  }
  return {
    label,
    seed,
    trajectoryIndex,
    telemetryVersion: TELEMETRY_VERSION,
    timestamp: new Date().toISOString(),
    config,
    points,
    diagnostics: summarizeTelemetry(points),
  };
}

/** Per-channel accuracy summary over a point set. Pure. */
export function summarizeTelemetry(points: readonly TelemetryPoint[]): ChannelDiagnostics[] {
  return TELEMETRY_CHANNELS.map((channel) => {
    const mine = points.filter((p) => p.channel === channel);
    const ok = mine.filter((p) => p.quality === 'ok' && p.residual !== null);
    const residuals = ok.map((p) => p.residual!);
    const nOk = residuals.length;
    return {
      channel,
      unit: TELEMETRY_UNITS[channel],
      n: mine.length,
      nOk,
      nMissing: mine.filter((p) => p.quality === 'missing').length,
      nRejected: mine.filter((p) => p.quality === 'rejected').length,
      rmse: nOk === 0 ? null : Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / nOk),
      meanResidual: nOk === 0 ? null : residuals.reduce((a, r) => a + r, 0) / nOk,
    };
  });
}

/**
 * Map a schedule onto state indices: state `s` reports the controls in effect
 * at that time (step `s`, clamped to the last step, so the initial state
 * reports step 0's setpoints). Pure.
 */
export function scheduleControlsForState(
  schedule: DynamicSchedule,
): (stateIndex: number) => Controls {
  return (stateIndex: number) => {
    const step = Math.max(0, Math.min(stateIndex, TOTAL_STEPS - 1));
    return controlsAt(schedule, step);
  };
}

/**
 * Observe every surviving trajectory of a dynamic ensemble.
 *
 * Each trajectory keeps its own `trajectoryIndex` streams, so adding or
 * removing realizations never reshuffles another trajectory's telemetry.
 * Rejected (short) trajectories are observed over the states they have.
 */
export function observeEnsemble(
  ensemble: DynamicEnsemble,
  config: TelemetryConfig,
  seed: number = ensemble.seed,
): TelemetryRun[] {
  assertValidTelemetryConfig(config);
  const controlsForState = scheduleControlsForState(ensemble.schedule);
  return ensemble.trajectories.map((trajectory) =>
    observeTrajectory({
      states: trajectory.states,
      controlsAt: controlsForState,
      config,
      seed,
      trajectoryIndex: trajectory.index,
      label: `Trajectory ${trajectory.index} telemetry`,
    }),
  );
}
