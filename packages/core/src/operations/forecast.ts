/**
 * Forecast branching from an estimated state (Phase 4).
 *
 * The one genuinely new core capability of this phase: run the existing
 * `step()` forward from any recorded state (typically the latest posterior
 * mean) under any schedule. Pure step loops — the scientific model remains
 * the sole source of truth, and depletion truncates loudly with a reason
 * instead of producing NaNs.
 */

import { DT_SECONDS, TOTAL_STEPS, controlsAt, type DynamicSchedule } from '../dynamics/schedule.js';
import { step } from '../dynamics/step.js';
import { toDynamicParams } from '../dynamics/init.js';
import type { DynamicParams, ReservoirState } from '../dynamics/types.js';
import { toResourceInputs } from '../model.js';
import { percentile } from '../stats.js';
import type { ParameterKey, ParameterSpec } from '../types.js';
import type { DynamicParameterKey, DynamicParameterSpec } from '../dynamics/types.js';
import type { EnsembleMemberForecast, ForecastResult, ScenarioForecast } from './types.js';

export interface ForecastInput {
  /** Branch-point state; never mutated. */
  fromState: ReservoirState;
  /** Parameters governing the forward run. */
  params: DynamicParams;
  /** Schedule covering [startStep, startStep + nSteps). */
  schedule: DynamicSchedule;
  /** Absolute step index the forecast branches from. */
  startStep: number;
  /** Monthly steps to simulate. */
  nSteps: number;
}

/**
 * Deterministic forecast. Steps beyond the schedule horizon wrap to the
 * schedule's final step, so short custom schedules still run full horizons.
 */
export function forecastFromState(input: ForecastInput): ForecastResult {
  const { fromState, params, schedule, startStep, nSteps } = input;
  if (!Number.isInteger(startStep) || startStep < 0 || startStep >= TOTAL_STEPS) {
    throw new RangeError(`forecast: startStep must lie in [0, ${TOTAL_STEPS}), got ${startStep}.`);
  }
  if (!Number.isInteger(nSteps) || nSteps < 1 || nSteps > TOTAL_STEPS * 2) {
    throw new RangeError(`forecast: nSteps must lie in [1, ${TOTAL_STEPS * 2}], got ${nSteps}.`);
  }
  const states: ReservoirState[] = [{ ...fromState }];
  let current = states[0]!;
  for (let k = 0; k < nSteps; k++) {
    // Clamp to the schedule's final step so custom short schedules still
    // cover the horizon with their last operating point held constant.
    const stepIndex = Math.min(startStep + k, TOTAL_STEPS - 1);
    try {
      current = step(current, controlsAt(schedule, stepIndex), params, DT_SECONDS).state;
    } catch (error) {
      return {
        states,
        truncated: true,
        stopReason: error instanceof Error ? error.message : 'Unknown step failure.',
        startStep,
      };
    }
    states.push({ ...current });
  }
  return { states, truncated: false, stopReason: null, startStep };
}

export interface EnsembleForecastInput {
  members: { index: number; state: ReservoirState; params: DynamicParams }[];
  schedule: DynamicSchedule;
  startStep: number;
  nSteps: number;
}

/** Same branch for many members; depleted members stop early, counted loudly. */
export function forecastEnsemble(input: EnsembleForecastInput): {
  members: EnsembleMemberForecast[];
  rejected: number;
} {
  const members: EnsembleMemberForecast[] = [];
  let rejected = 0;
  for (const member of input.members) {
    const result = forecastFromState({
      fromState: member.state,
      params: member.params,
      schedule: input.schedule,
      startStep: input.startStep,
      nSteps: input.nSteps,
    });
    members.push({ index: member.index, states: result.states, truncated: result.truncated });
    if (result.truncated) rejected++;
  }
  return { members, rejected };
}

/** One band point: conservative P90 through median to optimistic P10. */
export interface BandPoint {
  t: number;
  p90: number;
  p50: number;
  p10: number;
}

export interface ScenarioEnsembleInput {
  scenarioId: string;
  /** Estimated state every member branches from (cloned per member). */
  estimatedState: ReservoirState;
  parameters: Record<ParameterKey, ParameterSpec>;
  dynamicParameters: Record<DynamicParameterKey, DynamicParameterSpec>;
  staticColumns: Record<ParameterKey, number[]>;
  dynamicColumns: Record<DynamicParameterKey, number[]>;
  lifetimeYears: number;
  schedule: DynamicSchedule;
  startStep: number;
  nSteps: number;
}

/**
 * Scenario uncertainty done honestly: every member starts from the SAME
 * estimated state and differs only in sampled reservoir parameters, so the
 * bands show parametric uncertainty about this forecast — not a redrawn
 * history. Members that deplete are excluded from bands and counted.
 */
export function forecastScenarioEnsemble(input: ScenarioEnsembleInput): ScenarioForecast & {
  bands: Record<'temperatureC' | 'pressureBar' | 'generationMWe', BandPoint[]>;
} {
  const n = input.staticColumns.A?.length ?? 0;
  if (n < 2) throw new RangeError(`operations: scenario ensemble needs >= 2 members, got ${n}.`);
  const members: { index: number; state: ReservoirState; params: DynamicParams }[] = [];
  for (let i = 0; i < n; i++) {
    const values = Object.fromEntries(
      Object.keys(input.parameters).map((key) => [
        key,
        input.staticColumns[key as ParameterKey]![i],
      ]),
    ) as Record<ParameterKey, number>;
    const dynamicValues = {
      cTotal: input.dynamicColumns.cTotal![i]!,
      recharge: input.dynamicColumns.recharge![i]!,
    };
    const resourceInputs = toResourceInputs(values, input.lifetimeYears);
    members.push({
      index: i,
      state: { ...input.estimatedState },
      params: toDynamicParams(resourceInputs, {
        totalCompressibilityPerBar: dynamicValues.cTotal,
        rechargeKgS: dynamicValues.recharge,
      }),
    });
  }
  const mostLikelyValues = Object.fromEntries(
    Object.keys(input.parameters).map((key) => [
      key,
      input.parameters[key as ParameterKey]!.mostLikely,
    ]),
  ) as Record<ParameterKey, number>;
  const deterministic = forecastFromState({
    fromState: input.estimatedState,
    params: toDynamicParams(toResourceInputs(mostLikelyValues, input.lifetimeYears), {
      totalCompressibilityPerBar: input.dynamicParameters.cTotal.mostLikely,
      rechargeKgS: input.dynamicParameters.recharge.mostLikely,
    }),
    schedule: input.schedule,
    startStep: input.startStep,
    nSteps: input.nSteps,
  });
  const { members: memberForecasts, rejected } = forecastEnsemble({
    members,
    schedule: input.schedule,
    startStep: input.startStep,
    nSteps: input.nSteps,
  });
  const full = memberForecasts.filter((m) => !m.truncated);
  const band = (
    pick: (s: ReservoirState) => number,
  ): BandPoint[] => {
    const points: BandPoint[] = [];
    for (let k = 0; k <= input.nSteps; k++) {
      const values = full
        .map((m) => m.states[k])
        .filter((s): s is ReservoirState => s !== undefined)
        .map(pick)
        .filter(Number.isFinite);
      if (values.length === 0) continue;
      points.push({
        t: deterministic.states[k]?.timeYears ?? NaN,
        p90: percentile(values, 0.1),
        p50: percentile(values, 0.5),
        p10: percentile(values, 0.9),
      });
    }
    return points;
  };
  return {
    scenarioId: input.scenarioId,
    deterministic,
    members: memberForecasts,
    rejected,
    bands: {
      temperatureC: band((s) => s.temperatureC),
      pressureBar: band((s) => s.pressureBar),
      generationMWe: band((s) => s.capacityMweInstant),
    },
  };
}
