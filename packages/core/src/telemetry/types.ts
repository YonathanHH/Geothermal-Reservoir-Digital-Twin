/**
 * Shared vocabulary for the synthetic field telemetry layer (Phase 1.5).
 *
 * The dynamic tank produces the hidden TRUE state. This module defines what a
 * synthetic operating field REPORTS about that state: timestamped,
 * sensor-specific observations with noise, bias, dropouts and quality flags.
 * Nothing here feeds back into the reservoir equations — telemetry is a pure
 * view over trajectories, which is what keeps a future Phase 2 free to replace
 * synthetic observations with real ones without touching the reservoir model.
 *
 * The synthetic field has one production well (PW-01) and one plant. A lumped
 * single-tank model cannot honestly feed distinct wells with distinct
 * conditions, so per-well variation is deliberately NOT modelled; see
 * `docs/ASSUMPTIONS.md` §12. All values are synthetic — never real field data.
 */

/** A measurable channel of the synthetic field. */
export type TelemetryChannel =
  | 'temperatureC'
  | 'pressureBar'
  | 'productionKgS'
  | 'injectionKgS'
  | 'generationMWe';

/** The five channels in a stable order. */
export const TELEMETRY_CHANNELS = [
  'temperatureC',
  'pressureBar',
  'productionKgS',
  'injectionKgS',
  'generationMWe',
] as const satisfies readonly TelemetryChannel[];

/** Physical unit of each channel. */
export const TELEMETRY_UNITS: Record<TelemetryChannel, string> = {
  temperatureC: '°C',
  pressureBar: 'bar',
  productionKgS: 'kg/s',
  injectionKgS: 'kg/s',
  generationMWe: 'MWe',
};

/** Where each channel is measured on the synthetic field. */
export const TELEMETRY_SOURCES: Record<TelemetryChannel, 'PW-01' | 'plant'> = {
  temperatureC: 'PW-01',
  pressureBar: 'PW-01',
  productionKgS: 'PW-01',
  injectionKgS: 'plant',
  generationMWe: 'plant',
};

/**
 * Observation quality.
 *
 * - `ok`: a usable measurement (possibly noisy).
 * - `missing`: the sensor reported nothing this step (dropout). No value.
 * - `rejected`: a reading arrived but is physically implausible, so the layer
 *   refuses it instead of passing a misleading number downstream. No value.
 */
export type QualityFlag = 'ok' | 'missing' | 'rejected';

/** Noise and failure behaviour of one sensor channel. */
export interface SensorConfig {
  /** Gaussian noise std dev, in channel units. 0 means a perfect sensor. */
  sigma: number;
  /** Constant sensor offset added after noise, in channel units. */
  bias: number;
  /** Probability per observation of reporting nothing, in [0, 1). */
  dropoutRate: number;
}

/** Full telemetry configuration: one sensor per channel plus the cadence. */
export interface TelemetryConfig {
  channels: Record<TelemetryChannel, SensorConfig>;
  /**
   * Steps between observations. 1 = every monthly step (V1 cadence).
   * The record carries continuous `timeYears`, so future sub-step sampling
   * (weekly/daily) can be added without changing this schema.
   */
  cadenceSteps: number;
}

/**
 * One observed channel at one time — the Phase-2 handoff record.
 *
 * `trueValue` is the hidden reservoir/controls value; `observedValue` is what
 * the synthetic sensor reported (`null` unless `quality === 'ok'`);
 * `residual` is observed minus true (`null` unless ok).
 */
export interface TelemetryPoint {
  /** Continuous simulation time, years (cadence-independent). */
  timeYears: number;
  /** Reservoir step index this observation was taken at. */
  stepIndex: number;
  channel: TelemetryChannel;
  /** Where the measurement was taken: production well or plant. */
  source: 'PW-01' | 'plant';
  unit: string;
  trueValue: number;
  observedValue: number | null;
  residual: number | null;
  quality: QualityFlag;
  /** Machine-readable reason when quality is not ok (e.g. 'dropout'). */
  reason: string | null;
}

/** Per-channel accuracy summary over the `ok` points of a run. */
export interface ChannelDiagnostics {
  channel: TelemetryChannel;
  unit: string;
  n: number;
  nOk: number;
  nMissing: number;
  nRejected: number;
  /** Root-mean-square residual over ok points (`null` when none). */
  rmse: number | null;
  /** Mean residual over ok points (`null` when none). */
  meanResidual: number | null;
}

/** Complete telemetry record for one trajectory. */
export interface TelemetryRun {
  label: string;
  seed: number;
  trajectoryIndex: number;
  telemetryVersion: string;
  timestamp: string;
  config: TelemetryConfig;
  points: TelemetryPoint[];
  diagnostics: ChannelDiagnostics[];
}
