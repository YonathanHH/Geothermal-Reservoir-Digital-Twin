/**
 * Telemetry defaults and versioning (Phase 1.5).
 *
 * Sensor noise stands in for instrument precision, not reservoir physics: the
 * sigmas below are plausible meter accuracies for a geothermal field, chosen
 * so the observed series visibly differs from truth without drowning it.
 * Dropout rates are small on purpose — gaps must be observable, not dominant.
 */

import type { TelemetryChannel, TelemetryConfig } from './types.js';

/** Version of the telemetry module, recorded on every telemetry run. */
export const TELEMETRY_VERSION = '0.1.0';

/** Default sensor behaviour per channel (synthetic demonstration values). */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  cadenceSteps: 1,
  channels: {
    temperatureC: { sigma: 1.5, bias: 0, dropoutRate: 0.01 },
    pressureBar: { sigma: 0.8, bias: 0, dropoutRate: 0.01 },
    productionKgS: { sigma: 1.0, bias: 0, dropoutRate: 0.005 },
    injectionKgS: { sigma: 1.0, bias: 0, dropoutRate: 0.005 },
    generationMWe: { sigma: 0.15, bias: 0, dropoutRate: 0.005 },
  } satisfies Record<TelemetryChannel, { sigma: number; bias: number; dropoutRate: number }>,
};

/** Zero-noise configuration: perfect sensors, no dropouts. Must reproduce truth. */
export function zeroNoiseConfig(cadenceSteps = 1): TelemetryConfig {
  const channels = Object.fromEntries(
    (Object.keys(DEFAULT_TELEMETRY_CONFIG.channels) as TelemetryChannel[]).map((channel) => [
      channel,
      { sigma: 0, bias: 0, dropoutRate: 0 },
    ]),
  ) as TelemetryConfig['channels'];
  return { cadenceSteps, channels };
}

/** Deep copy of the default config, safe to mutate in the UI. */
export function cloneTelemetryConfig(
  config: TelemetryConfig = DEFAULT_TELEMETRY_CONFIG,
): TelemetryConfig {
  return {
    cadenceSteps: config.cadenceSteps,
    channels: Object.fromEntries(
      (Object.keys(config.channels) as TelemetryChannel[]).map((channel) => [
        channel,
        { ...config.channels[channel] },
      ]),
    ) as TelemetryConfig['channels'],
  };
}

/** Throw `RangeError` on any non-physical sensor configuration. */
export function assertValidTelemetryConfig(config: TelemetryConfig): void {
  if (!Number.isInteger(config.cadenceSteps) || config.cadenceSteps < 1) {
    throw new RangeError(
      `telemetry: cadenceSteps must be an integer >= 1, got ${config.cadenceSteps}.`,
    );
  }
  for (const channel of Object.keys(config.channels) as TelemetryChannel[]) {
    const sensor = config.channels[channel];
    if (!Number.isFinite(sensor.sigma) || sensor.sigma < 0) {
      throw new RangeError(`telemetry: ${channel}.sigma must be >= 0, got ${sensor.sigma}.`);
    }
    if (!Number.isFinite(sensor.bias)) {
      throw new RangeError(`telemetry: ${channel}.bias must be finite, got ${sensor.bias}.`);
    }
    if (!Number.isFinite(sensor.dropoutRate) || sensor.dropoutRate < 0 || sensor.dropoutRate >= 1) {
      throw new RangeError(
        `telemetry: ${channel}.dropoutRate must lie in [0, 1), got ${sensor.dropoutRate}.`,
      );
    }
  }
}
