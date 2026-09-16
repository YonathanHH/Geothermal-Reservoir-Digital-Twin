/**
 * Shared vocabulary for ensemble state estimation (Phase 2).
 *
 * The twin distinguishes three things at every assimilation time:
 * - the TRUE state (the synthetic field's hidden trajectory),
 * - the OBSERVED telemetry (noisy wellhead readings of that truth), and
 * - the ESTIMATED posterior state (the ensemble after the EnKF analysis).
 *
 * The estimated state vector is x = [temperatureC, pressureBar, fluidMassKg].
 * Stored energy and instantaneous capacity are not estimated — they are
 * rebuilt deterministically from the posterior (T, p) with the same static
 * eq.-2/exergy formulas the forward model uses, so posterior states are
 * internally consistent by construction. Rates are known controls, not state.
 */

import type { ReservoirState } from '../dynamics/types.js';

/** Index of temperature in the state vector. */
export const STATE_T = 0;
/** Index of pressure in the state vector. */
export const STATE_P = 1;
/** Index of fluid mass in the state vector. */
export const STATE_M = 2;
/** State dimension. */
export const STATE_DIM = 3;

/** A single ensemble member as a vector: [temperatureC, pressureBar, fluidMassKg]. */
export type StateVector = [number, number, number];

/** One assimilated reading: wellhead channel, value, and its noise std dev. */
export interface AssimilatedObservation {
  channel: 'temperatureC' | 'pressureBar';
  /** Observed value, in channel units. */
  value: number;
  /** Assumed observation-error std dev (the sensor sigma), in channel units. */
  sigma: number;
}

/** Outcome of one EnKF analysis across the ensemble. */
export interface EnkfAnalysis {
  /** Posterior vectors, one per forecast member, in member order. */
  posterior: StateVector[];
  /** Kalman gain (STATE_DIM × nObs); empty when nothing was assimilated. */
  gain: number[][];
  /** Channels actually used this cycle (missing readings are skipped). */
  channelsUsed: ('temperatureC' | 'pressureBar')[];
}

/** Per-cycle twin diagnostics, all as ensemble means over common members. */
export interface TwinCycle {
  stepIndex: number;
  timeYears: number;
  members: number;
  channelsUsed: ('temperatureC' | 'pressureBar')[];
  /** Mean |prior mean − truth| for T (°C) and p (bar). */
  priorErrT: number;
  priorErrP: number;
  /** Mean |posterior mean − truth| for T (°C) and p (bar). */
  postErrT: number;
  postErrP: number;
  /** Mean |free-run mean − truth|: the no-assimilation control. */
  freeErrT: number;
  freeErrP: number;
  /** Ensemble std dev (spread) of T before/after the analysis. */
  priorSpreadT: number;
  postSpreadT: number;
  /** Truth and mean estimates (for prediction-vs-observation-vs-posterior plots). */
  truthT: number;
  truthP: number;
  truthGen: number;
  priorMeanT: number;
  priorMeanP: number;
  priorMeanGen: number;
  postMeanT: number;
  postMeanP: number;
  postMeanGen: number;
  freeMeanT: number;
  freeMeanP: number;
  freeMeanGen: number;
  /**
   * Innovation (observation minus prior mean) per channel, null when the
   * channel had no usable reading this cycle.
   */
  innovT: number | null;
  innovP: number | null;
  /**
   * Expected innovation std dev, sqrt(sample variance + R), per channel —
   * the envelope innovations should mostly stay inside. Null when unused.
   */
  innovStdT: number | null;
  innovStdP: number | null;
}

/** Headline result of a twin experiment. */
export interface TwinResult {
  label: string;
  seed: number;
  n: number;
  /** Versions of every layer involved, so archived runs stay interpretable. */
  modelVersion: string;
  dynamicsVersion: string;
  assimilationVersion: string;
  cycles: TwinCycle[];
  /** Final-cycle error ratio posterior/free for T (< 1 means assimilation helped). */
  errorRatioT: number;
  /** Final-cycle error ratio posterior/free for p. */
  errorRatioP: number;
  /** Truth trajectory (hidden state). */
  truth: ReservoirState[];
  /** Posterior-mean trajectory (estimated state). */
  posteriorMean: ReservoirState[];
  /** Free-run mean trajectory (no-assimilation control). */
  freeMean: ReservoirState[];
  /** Members that exhausted their tank mid-run (assimilated / free counts). */
  rejectedAssimilated: number;
  rejectedFree: number;
  /** Posterior vectors that failed validation and kept their forecast. */
  totalFallbacks: number;
  /** Cycles where the analysis itself was skipped (singular ensemble). */
  analysisSkipped: number;
}
