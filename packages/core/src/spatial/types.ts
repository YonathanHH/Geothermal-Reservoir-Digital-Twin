/**
 * Shared vocabulary for the spatial field layer (Phase 3).
 *
 * The lumped tank remains the sole mass/energy engine. This module maps its
 * bulk state onto a synthetic field: wells with coordinates inside the
 * reservoir footprint, each reporting local conditions derived from the bulk
 * state plus steady influence cones from production and injection. Nothing
 * here feeds back into the dynamics — it is a pure disaggregation view, the
 * same relationship the telemetry layer has to the tank. See MODEL_SPEC §14
 * and ASSUMPTIONS §14: these are influence-function illustrations, not flow
 * simulation results.
 *
 * Units: metres for plan coordinates and depth, degC, bar, kg/s throughout.
 */

export type WellKind = 'production' | 'injection' | 'observation';

/** A well with a fixed position in the reservoir footprint. */
export interface Well {
  /** Stable identity, e.g. 'P-01'. Never reused, never reordered. */
  id: string;
  /** Human label, e.g. 'Production well P-01'. */
  name: string;
  kind: WellKind;
  /** Easting of the wellhead, metres from field centre. */
  xM: number;
  /** Northing of the wellhead, metres from field centre. */
  yM: number;
  /** Well depth (total vertical depth), metres. */
  depthM: number;
  /**
   * Share of its kind's total field rate carried by this well, in [0, 1].
   * Shares sum to 1 within each rate-carrying kind; observation wells carry 0.
   */
  rateShare: number;
  /** 'flowing' when rateShare > 0, else 'shut-in'. Derived, not stored. */
  status: 'flowing' | 'shut-in';
}

/** Plan-view reservoir footprint: an ellipse centred on the field origin. */
export interface FieldBoundary {
  /** Semi-axis east–west, metres. */
  radiusXM: number;
  /** Semi-axis north–south, metres. */
  radiusYM: number;
}

/** A complete, reproducible synthetic field layout. */
export interface FieldLayout {
  wells: Well[];
  boundary: FieldBoundary;
  /** Reservoir area the footprint was derived from, km². */
  areaKm2: number;
  /** Seed the layout was generated from. */
  seed: number;
  layoutVersion: string;
}

/** True local conditions at one well at one time. */
export interface WellConditions {
  wellId: string;
  timeYears: number;
  /** Local fluid temperature, degC. */
  temperatureC: number;
  /** Local flowing pressure, bar. */
  pressureBar: number;
  /** This well's rate at this time, kg/s (0 for observation wells). */
  rateKgS: number;
  /** True when pressure hit the plausibility floor (deep drawdown). */
  pressureLimited: boolean;
}

/** True conditions at every well plus the bulk state they derive from. */
export interface SpatialSnapshot {
  timeYears: number;
  stepIndex: number;
  bulkTemperatureC: number;
  bulkPressureBar: number;
  wells: WellConditions[];
}

/** One gridded field cell for heatmap rendering. */
export interface FieldCell {
  /** Cell centre easting/northing, metres. */
  xM: number;
  yM: number;
  /** Inside the reservoir ellipse (cells outside are not rendered). */
  inside: boolean;
  temperatureC: number;
  pressureBar: number;
}

/** Effective influence parameters (documented reduced-order coefficients). */
export interface SpatialParams {
  /**
   * Drawdown per unit rate, bar/(kg/s). Sets how many bar of flowing
   * pressure one kg/s of local withdrawal (or injection support) is worth.
   */
  drawdownPerRate: number;
  /**
   * Pressure influence length as a fraction of the footprint equivalent
   * radius. Cones decay as exp(−d/L).
   */
  influenceLengthFrac: number;
  /**
   * Maximum fractional approach of a producer's temperature toward injection
   * temperature from nearby injectors (thermal-breakthrough proxy).
   */
  coolingFraction: number;
  /** Thermal influence length as a fraction of the equivalent radius. */
  thermalLengthFrac: number;
}

/** Noisy surveillance reading at one well (mirrors telemetry conventions). */
export interface WellObservation {
  wellId: string;
  kind: WellKind;
  timeYears: number;
  stepIndex: number;
  channel: 'temperatureC' | 'pressureBar';
  unit: string;
  trueValue: number;
  observedValue: number | null;
  residual: number | null;
  quality: 'ok' | 'missing' | 'rejected';
  reason: string | null;
}
