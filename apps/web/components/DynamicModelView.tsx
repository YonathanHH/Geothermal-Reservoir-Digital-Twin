'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  dynamics,
  mostLikelyInputs,
  percentile,
  type ParameterKey,
  type ParameterSpec,
} from '@geo/core';
import { TimeSeriesChart } from './TimeSeriesChart';
import { formatNumber } from '../lib/format';

const HORIZON_OPTIONS = [10, 20, 30];
const ENSEMBLE_OPTIONS = [50, 100, 200];
const STEPS_PER_YEAR = 12;

/**
 * Dynamic model view.
 *
 * A thin shell over `packages/core/src/dynamics/`: every number below comes
 * from the core (`initialDynamicState`, `step`, `runDynamicEnsemble`,
 * `percentile`). The only arithmetic in this file is display bookkeeping —
 * slicing a horizon and accumulating MWh from MWe over time — never reservoir
 * physics.
 */
export function DynamicModelView({
  parameters,
  seed,
}: {
  parameters: Record<ParameterKey, ParameterSpec>;
  seed: number;
}) {
  const [productionKgS, setProductionKgS] = useState(dynamics.DEFAULT_PRODUCTION_KG_S);
  const [injectionKgS, setInjectionKgS] = useState(dynamics.DEFAULT_INJECTION_KG_S);
  const [injectionTemperatureC, setInjectionTemperatureC] = useState(
    dynamics.DEFAULT_INJECTION_TEMPERATURE_C,
  );
  const [horizonYears, setHorizonYears] = useState(30);
  const [ensembleN, setEnsembleN] = useState(100);

  const deferred = useDeferredValue({
    parameters,
    seed,
    productionKgS,
    injectionKgS,
    injectionTemperatureC,
    ensembleN,
  });
  const busy =
    deferred.parameters !== parameters ||
    deferred.seed !== seed ||
    deferred.productionKgS !== productionKgS ||
    deferred.injectionKgS !== injectionKgS ||
    deferred.injectionTemperatureC !== injectionTemperatureC ||
    deferred.ensembleN !== ensembleN;

  const model = useMemo(() => {
    const schedule = dynamics.constantSchedule(
      deferred.productionKgS,
      deferred.injectionKgS,
      deferred.injectionTemperatureC,
    );
    // Deterministic trajectory at every most-likely value (static and dynamic).
    try {
      const inputs = mostLikelyInputs(deferred.parameters, dynamics.HORIZON_YEARS);
      const { state: initial, params } = dynamics.initialDynamicState(inputs, {
        totalCompressibilityPerBar: dynamics.DEFAULT_DYNAMIC_PARAMETERS.cTotal.mostLikely,
        rechargeKgS: dynamics.DEFAULT_DYNAMIC_PARAMETERS.recharge.mostLikely,
      });
      const states: dynamics.ReservoirState[] = [initial];
      let current = initial;
      let completedSteps = 0;
      try {
        for (let s = 0; s < dynamics.TOTAL_STEPS; s++) {
          current = dynamics.step(current, schedule.controls, params, dynamics.DT_SECONDS).state;
          states.push(current);
          completedSteps = s + 1;
        }
      } catch (stepError) {
        throw new Error(
          `Year ${(completedSteps / STEPS_PER_YEAR).toFixed(1)}: ${(stepError as Error).message}`,
        );
      }
      const ensemble = dynamics.runDynamicEnsemble({
        n: deferred.ensembleN,
        seed: deferred.seed,
        parameters: deferred.parameters,
        schedule,
      });
      return { states, params, ensemble, schedule, error: null as string | null };
    } catch (error) {
      return {
        states: null,
        params: null,
        ensemble: null,
        schedule,
        error:
          error instanceof RangeError || error instanceof Error
            ? error.message
            : 'The dynamic model could not be evaluated with these controls.',
      };
    }
  }, [deferred]);

  const stepsToShow = horizonYears * STEPS_PER_YEAR;
  const shown = model.states?.slice(0, stepsToShow + 1) ?? null;
  const dtHours = dynamics.DT_SECONDS / 3600;

  // Display bookkeeping only: the time-integral of the core's power output.
  // Cumulative energy is Σ P·dt, not a reservoir equation.
  const cumulativeGwh =
    shown?.reduce<number[]>((acc, s, i) => {
      if (i === 0) return [0];
      acc.push(acc[i - 1]! + (s.capacityMweInstant * dtHours) / 1000);
      return acc;
    }, []) ?? [];

  const seriesOf = (
    states: dynamics.ReservoirState[],
    pick: (s: dynamics.ReservoirState) => number,
  ) => states.map((s) => ({ t: s.timeYears, value: pick(s) }));

  // Ensemble bands reuse the static exceedance convention: P90 is the
  // conservative (low) value, i.e. percentile 0.1; P10 is percentile 0.9.
  const bandOf = (
    label: string,
    pick: (s: dynamics.ReservoirState) => number,
  ): React.ComponentProps<typeof TimeSeriesChart>['band'] => {
    if (!model.ensemble || model.ensemble.trajectories.length === 0) return null;
    const n = Math.min(stepsToShow, dynamics.TOTAL_STEPS);
    const points = [];
    for (let s = 0; s <= n; s++) {
      const values = model.ensemble.trajectories
        .map((t) => t.states[s])
        .filter((st): st is dynamics.ReservoirState => st !== undefined)
        .map(pick)
        .filter(Number.isFinite);
      if (values.length === 0) continue;
      points.push({
        t: s / STEPS_PER_YEAR,
        p90: percentile(values, 0.1),
        p50: percentile(values, 0.5),
        p10: percentile(values, 0.9),
      });
    }
    return { label, points };
  };

  const start = shown?.[0];
  const end = shown?.at(-1);

  return (
    <div className="stack">
      <div className="panel">
        <h2>Reduced-order synthetic dynamic reservoir model</h2>
        <p className="panel__intro">
          Static resource assessment → dynamic reservoir state → production/injection
          controls → 30-year monthly trajectory → Monte Carlo uncertainty. The tank is a
          single well-mixed block evolved by core mass/energy balances — a{' '}
          <strong>reduced-order synthetic model, not a high-fidelity reservoir
          simulator</strong> (dynamics version {dynamics.DYNAMICS_VERSION}).
        </p>
        <p className="note">
          Instantaneous generation answers “what does this rate deliver at this state”;
          the static capacity answers “what average does the whole stock sustain over the
          project life”. The two numbers are not directly comparable.
        </p>
      </div>

      <div className="panel">
        <h2>Operating controls</h2>
        <div className="controls">
          <div className="control">
            <label htmlFor="dyn-prod">Production rate (kg/s)</label>
            <input
              id="dyn-prod"
              type="number"
              className="cell-input tabular"
              value={productionKgS}
              min={0}
              onChange={(event) => setProductionKgS(Number(event.target.value))}
            />
          </div>
          <div className="control">
            <label htmlFor="dyn-inj">Injection rate (kg/s)</label>
            <input
              id="dyn-inj"
              type="number"
              className="cell-input tabular"
              value={injectionKgS}
              min={0}
              onChange={(event) => setInjectionKgS(Number(event.target.value))}
            />
          </div>
          <div className="control">
            <label htmlFor="dyn-tinj">Injection temperature (°C)</label>
            <input
              id="dyn-tinj"
              type="number"
              className="cell-input tabular"
              value={injectionTemperatureC}
              min={1}
              max={349}
              onChange={(event) => setInjectionTemperatureC(Number(event.target.value))}
            />
          </div>
          <div className="control">
            <label htmlFor="dyn-horizon">Horizon (years)</label>
            <select
              id="dyn-horizon"
              className="cell-input"
              value={horizonYears}
              onChange={(event) => setHorizonYears(Number(event.target.value))}
            >
              {HORIZON_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor="dyn-n">Ensemble trajectories</label>
            <select
              id="dyn-n"
              className="cell-input"
              value={ensembleN}
              onChange={(event) => setEnsembleN(Number(event.target.value))}
            >
              {ENSEMBLE_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </div>
          <span className="controls__status" role="status" aria-live="polite">
            {busy ? 'Recomputing…' : ''}
          </span>
        </div>
        <p className="note">
          Monthly timestep (fixed). The ensemble is capped at 200 trajectories to keep the
          browser responsive; every trajectory integrates 360 core steps.
        </p>
      </div>

      {model.error || !shown || !start || !end ? (
        <div className="alert" role="alert">
          <strong>These controls fall outside the dynamic model&rsquo;s domain of validity.</strong>
          <p>{model.error ?? 'No trajectory to display.'}</p>
          <p>
            The tank refuses depleted or two-phase states rather than returning a
            plausible-looking curve. Lower the production rate or raise injection.
          </p>
        </div>
      ) : (
        <main className={busy ? 'is-stale' : undefined}>
          <div className="grid-2">
            <TimeSeriesChart
              title="Reservoir temperature"
              yLabel="Temperature (°C)"
              lines={[{ label: 'Most-likely trajectory', points: seriesOf(shown, (s) => s.temperatureC) }]}
              band={bandOf('Temperature', (s) => s.temperatureC)}
              digits={1}
              caption="Bulk tank temperature. Injection at 60 °C cools the block; the band spans ensemble geology."
            />
            <TimeSeriesChart
              title="Reservoir pressure"
              yLabel="Pressure (bar)"
              lines={[{ label: 'Most-likely trajectory', points: seriesOf(shown, (s) => s.pressureBar) }]}
              band={bandOf('Pressure', (s) => s.pressureBar)}
              digits={1}
              caption="Linearised storage response to net mass withdrawal. Exhausted tanks are rejected, not plotted."
            />
          </div>
          <div className="grid-2">
            <TimeSeriesChart
              title="Instantaneous generation"
              yLabel="Capacity (MWe)"
              lines={[{ label: 'Most-likely trajectory', points: seriesOf(shown, (s) => s.capacityMweInstant) }]}
              band={bandOf('Generation', (s) => s.capacityMweInstant)}
              caption="Power the current rate sustains at the current state — not the static lifetime average."
            />
            <TimeSeriesChart
              title="Operating rates and cumulative generation"
              yLabel="Rate (kg/s) · energy (GWh)"
              lines={[
                { label: 'Production (kg/s)', points: seriesOf(shown, () => model.schedule.controls.productionKgS) },
                { label: 'Injection (kg/s)', points: seriesOf(shown, () => model.schedule.controls.injectionKgS) },
                {
                  label: 'Cumulative generation (GWh)',
                  points: shown.map((s, i) => ({ t: s.timeYears, value: cumulativeGwh[i] ?? 0 })),
                },
              ]}
              caption="Prescribed flat rates plus the time-integral of instantaneous generation (display bookkeeping)."
            />
          </div>

          <div className="panel">
            <h2>Starting and ending state</h2>
            <table className="data-table">
              <caption className="visually-hidden">Reservoir state at the start and end of the horizon</caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col" className="numeric">Start</th>
                  <th scope="col" className="numeric">End (year {horizonYears})</th>
                  <th scope="col">Unit</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Temperature', start.temperatureC, end.temperatureC, '°C', 2],
                    ['Pressure', start.pressureBar, end.pressureBar, 'bar', 2],
                    ['Fluid mass', start.fluidMassKg / 1e12, end.fluidMassKg / 1e12, 'Pg', 4],
                    ['Stored thermal energy', start.thermalEnergyPj, end.thermalEnergyPj, 'PJ', 2],
                    ['Instantaneous generation', start.capacityMweInstant, end.capacityMweInstant, 'MWe', 2],
                    ['Cumulative produced', 0, end.cumulativeProducedKg / 1e9, 'Mt', 2],
                    ['Cumulative injected', 0, end.cumulativeInjectedKg / 1e9, 'Mt', 2],
                    ['Cumulative generation', 0, cumulativeGwh.at(-1) ?? 0, 'GWh', 1],
                  ] as const
                ).map(([label, a, b, unit, digits]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className="numeric tabular">{formatNumber(a, digits)}</td>
                    <td className="numeric tabular">{formatNumber(b, digits)}</td>
                    <td className="unit">{unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {model.ensemble ? (
            <p className="note">
              Ensemble {model.ensemble.trajectories.length.toLocaleString('en-US')} trajectories
              on seed {model.ensemble.seed}
              {model.ensemble.rejected.length > 0
                ? `, ${model.ensemble.rejected.length} rejected as physically exhausted`
                : ', none rejected'}
              . Bands are P90–P10 across surviving trajectories with the P50 spine dashed.
            </p>
          ) : null}

          {model.ensemble && model.ensemble.rejected.length > 0 ? (
            <div className="panel">
              <h2>Rejected trajectories</h2>
              <p className="panel__intro">
                Realizations whose tank depleted its mass or pressure storage before the
                horizon ends. A small tank cannot sustain a large rate for 30 years — the
                model records where each one stopped rather than extrapolating.
              </p>
              <table className="data-table">
                <caption className="visually-hidden">Rejected ensemble trajectories</caption>
                <thead>
                  <tr>
                    <th scope="col">Realization</th>
                    <th scope="col" className="numeric">Survived to (yr)</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {model.ensemble.rejected.slice(0, 8).map((r) => (
                    <tr key={r.index}>
                      <th scope="row" className="tabular">#{r.index}</th>
                      <td className="numeric tabular">{formatNumber(Math.max(r.step, 0) / STEPS_PER_YEAR, 1)}</td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {model.ensemble.rejected.length > 8 ? (
                <p className="note">Showing 8 of {model.ensemble.rejected.length} rejected trajectories.</p>
              ) : null}
            </div>
          ) : null}
        </main>
      )}
    </div>
  );
}
