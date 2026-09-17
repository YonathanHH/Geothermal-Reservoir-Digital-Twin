'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  assimilation,
  dynamics,
  operations,
  telemetry,
  type ParameterKey,
  type ParameterSpec,
} from '@geo/core';
import { TimeSeriesChart } from './TimeSeriesChart';
import { formatNumber } from '../lib/format';

const HORIZON_OPTIONS = [10, 15, 20, 30];
const MEMBER_OPTIONS = [10, 20, 40];

/**
 * Operations view (Phase 4).
 *
 * A thin shell over `core/src/operations` + the existing twin: a twin run
 * fixes the current estimated state, scenario forecasts branch from it, and
 * alerts/outlooks are computed from recorded outputs. The only arithmetic
 * here is display slicing — no physics, no filtering, no thresholds.
 */
export function OperationsView({
  parameters,
  seed,
}: {
  parameters: Record<ParameterKey, ParameterSpec>;
  seed: number;
}) {
  const [productionKgS, setProductionKgS] = useState(dynamics.DEFAULT_PRODUCTION_KG_S);
  const [injectionKgS, setInjectionKgS] = useState(dynamics.DEFAULT_INJECTION_KG_S);
  const [horizonYears, setHorizonYears] = useState(15);
  const [ensembleN, setEnsembleN] = useState(20);
  const [selectedIds, setSelectedIds] = useState<string[]>(['baseline', 'high-production', 'high-injection', 'low-production']);
  const [customOn, setCustomOn] = useState(false);
  const [customProd, setCustomProd] = useState(60);
  const [customInj, setCustomInj] = useState(56);

  const deferred = useDeferredValue({
    parameters,
    seed,
    productionKgS,
    injectionKgS,
    horizonYears,
    ensembleN,
    selectedIds,
    customOn,
    customProd,
    customInj,
  });
  const busy = JSON.stringify(deferred) !== JSON.stringify({
    parameters, seed, productionKgS, injectionKgS, horizonYears, ensembleN,
    selectedIds, customOn, customProd, customInj,
  });

  const model = useMemo(() => {
    try {
      const schedule = dynamics.constantSchedule(
        deferred.productionKgS,
        deferred.injectionKgS,
        dynamics.DEFAULT_INJECTION_TEMPERATURE_C,
      );
      const twin = assimilation.runTwinExperiment({
        n: 50,
        seed: deferred.seed,
        parameters: deferred.parameters,
        schedule,
      });
      const estimated = twin.posteriorMean[twin.posteriorMean.length - 1]!;
      const startStep = dynamics.TOTAL_STEPS - 1;
      const nSteps = deferred.horizonYears * 12;
      const { staticColumns, dynamicColumns } = dynamics.sampleEnsembleColumns(
        deferred.ensembleN,
        deferred.seed,
        deferred.parameters,
        dynamics.DEFAULT_DYNAMIC_PARAMETERS,
      );
      const presets = operations.OPERATIONS_SCENARIOS.filter((s) => deferred.selectedIds.includes(s.id));
      const scenarios: { id: string; label: string; rates: { productionKgS: number; injectionKgS: number } | operations.OperationsScenario }[] = presets.map(
        (s) => ({ id: s.id, label: s.label, rates: s }),
      );
      if (deferred.customOn) {
        scenarios.push({
          id: 'custom',
          label: `Custom (${deferred.customProd}/${deferred.customInj} kg/s)`,
          rates: { productionKgS: deferred.customProd, injectionKgS: deferred.customInj },
        });
      }
      if (scenarios.length === 0) {
        return { twin, estimated, forecasts: [], outlooks: [], alerts: [], obs: null, error: null as string | null };
      }
      const forecasts = scenarios.map((s) => {
        const resolved = operations.resolveOperationsSchedule(schedule, s.rates, startStep);
        const result = operations.forecastScenarioEnsemble({
          scenarioId: s.id,
          estimatedState: estimated,
          parameters: deferred.parameters,
          dynamicParameters: dynamics.DEFAULT_DYNAMIC_PARAMETERS,
          staticColumns,
          dynamicColumns,
          lifetimeYears: 30,
          schedule: resolved,
          startStep,
          nSteps,
        });
        return { ...s, resolved, result };
      });
      const outlooks = forecasts.map((f) => ({
        ...f,
        outlook: operations.summarizeOutlook(f.id, f.result.deterministic),
      }));
      const obs = telemetry.observeTrajectory({
        states: twin.truth,
        controlsAt: telemetry.scheduleControlsForState(schedule),
        config: telemetry.cloneTelemetryConfig(),
        seed: deferred.seed,
        trajectoryIndex: 0,
      });
      const baseline = forecasts.find((f) => f.id === 'baseline') ?? forecasts[0]!;
      const alerts = operations.evaluateAlerts({
        cycles: twin.cycles,
        telemetry: obs.diagnostics,
        forecast: baseline.result.deterministic,
      });
      return { twin, estimated, forecasts, outlooks, alerts, obs, error: null as string | null };
    } catch (error) {
      return {
        twin: null,
        estimated: null,
        forecasts: [],
        outlooks: [],
        alerts: [],
        obs: null,
        error: error instanceof Error ? error.message : 'The operations run could not complete.',
      };
    }
  }, [deferred]);

  const toggleScenario = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );

  const seriesOf = (
    states: { timeYears: number; temperatureC: number; pressureBar: number; capacityMweInstant: number }[],
    pick: (s: (typeof states)[number]) => number,
  ) => states.map((s) => ({ t: s.timeYears, value: pick(s) }));

  return (
    <div className="stack">
      <div className="panel">
        <h2>Operations — forecast and decision support</h2>
        <p className="panel__intro">
          Current estimated state → deterministic forecast → scenario engine →
          uncertainty analysis → operational interpretation. A twin run fixes
          today&rsquo;s estimated state; every scenario branches from it, so
          differences are the effect of operating choices, not resampling.
          Reduced-order synthetic prototype — decision support, not dispatch
          instructions (operations version {operations.OPERATIONS_VERSION}).
        </p>
      </div>

      <div className="panel">
        <h2>Operating point and scenarios</h2>
        <div className="controls">
          <div className="control">
            <label htmlFor="ops-prod">Production (kg/s)</label>
            <input id="ops-prod" type="number" className="cell-input tabular" value={productionKgS} min={0}
              onChange={(event) => setProductionKgS(Number(event.target.value))} />
          </div>
          <div className="control">
            <label htmlFor="ops-inj">Injection (kg/s)</label>
            <input id="ops-inj" type="number" className="cell-input tabular" value={injectionKgS} min={0}
              onChange={(event) => setInjectionKgS(Number(event.target.value))} />
          </div>
          <div className="control">
            <label htmlFor="ops-horizon">Forecast horizon (yr)</label>
            <select id="ops-horizon" className="cell-input" value={horizonYears}
              onChange={(event) => setHorizonYears(Number(event.target.value))}>
              {HORIZON_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="control">
            <label htmlFor="ops-n">Band members</label>
            <select id="ops-n" className="cell-input" value={ensembleN}
              onChange={(event) => setEnsembleN(Number(event.target.value))}>
              {MEMBER_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="control">
            <label htmlFor="ops-custom-prod">Custom prod/inj (kg/s)</label>
            <span>
              <input id="ops-custom-prod" type="number" className="cell-input tabular" value={customProd} min={0}
                style={{ width: '4.5rem' }} onChange={(event) => setCustomProd(Number(event.target.value))} />
              {' / '}
              <input id="ops-custom-inj" type="number" className="cell-input tabular" value={customInj} min={0}
                style={{ width: '4.5rem' }} onChange={(event) => setCustomInj(Number(event.target.value))} />
              {' '}
              <label>
                <input type="checkbox" checked={customOn} onChange={(event) => setCustomOn(event.target.checked)} />
                {' include'}
              </label>
            </span>
          </div>
          <span className="controls__status" role="status" aria-live="polite">
            {busy ? 'Recomputing…' : ''}
          </span>
        </div>
        <div className="controls">
          {operations.OPERATIONS_SCENARIOS.map((s) => (
            <label key={s.id} className="control" title={s.notes}>
              <span>
                <input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggleScenario(s.id)} />
                {' '}{s.label}
              </span>
            </label>
          ))}
        </div>
        <p className="note">
          Seed {seed} · deterministic — same seed reproduces twin, forecasts and bands exactly.
          Bands show parametric uncertainty about each forecast from {ensembleN} sampled geologies.
        </p>
      </div>

      {model.error || !model.twin || !model.estimated ? (
        <div className="alert" role="alert">
          <strong>The operations run could not complete.</strong>
          <p>{model.error ?? 'No result to display.'}</p>
        </div>
      ) : (
        <main className={busy ? 'is-stale' : undefined}>
          <dl className="tiles">
            <div className="tile tile--hero" data-accent="estimate">
              <dt>Estimated T / p now</dt>
              <dd><span className="tile__value tile__value--sm tabular">{formatNumber(model.estimated.temperatureC, 1)} / {formatNumber(model.estimated.pressureBar, 1)}</span><span className="tile__unit">°C / bar</span></dd>
              <p className="tile__note">Posterior mean at twin end</p>
            </div>
            <div className="tile tile--hero" data-accent="estimate">
              <dt>Estimated generation now</dt>
              <dd><span className="tile__value tabular">{formatNumber(model.estimated.capacityMweInstant, 2)}</span><span className="tile__unit">MWe</span></dd>
              <p className="tile__note">At current operating rates</p>
            </div>
            {(() => {
              const base = model.outlooks.find((o) => o.id === 'baseline');
              const years = base?.outlook.yearsToPressureFloor;
              return (
                <div className="tile">
                  <dt>Baseline years to floor</dt>
                  <dd><span className="tile__value tabular">{years === null || years === undefined ? '—' : formatNumber(years, 1)}</span><span className="tile__unit">{years === null || years === undefined ? 'beyond horizon' : 'yr'}</span></dd>
                  <p className="tile__note">At current rates, 5 bar floor</p>
                </div>
              );
            })()}
            <div className="tile">
              <dt>Active alerts</dt>
              <dd><span className="tile__value tabular">{model.alerts.filter((a) => a.severity === 'warning').length} / {model.alerts.length}</span><span className="tile__unit">warning / total</span></dd>
              <p className="tile__note">Deterministic threshold rules</p>
            </div>
          </dl>

          <div className="grid-2">
            <TimeSeriesChart
              title="Generation forecast by scenario"
              yLabel="Capacity (MWe)"
              lines={model.forecasts.map((f) => ({
                label: f.label,
                points: seriesOf(f.result.deterministic.states, (s) => s.capacityMweInstant),
              }))}
              band={(() => {
                const base = model.forecasts.find((f) => f.id === 'baseline');
                return base ? { label: 'Baseline', points: base.result.bands.generationMWe } : null;
              })()}
              caption="Deterministic branches from today's estimated state; band is baseline parametric uncertainty (P10–P90)."
            />
            <TimeSeriesChart
              title="Pressure forecast by scenario"
              yLabel="Pressure (bar)"
              lines={model.forecasts.map((f) => ({
                label: f.label,
                points: seriesOf(f.result.deterministic.states, (s) => s.pressureBar),
              }))}
              band={(() => {
                const base = model.forecasts.find((f) => f.id === 'baseline');
                return base ? { label: 'Baseline', points: base.result.bands.pressureBar } : null;
              })()}
              digits={1}
              caption="Higher production steepens drawdown; higher injection supports pressure and cools the tank."
            />
          </div>

          <div className="panel">
            <h2>Scenario outlook</h2>
            <table className="data-table">
              <caption className="visually-hidden">End-of-horizon outlook per scenario</caption>
              <thead>
                <tr>
                  <th scope="col">Scenario</th>
                  <th scope="col" className="numeric">End T (°C)</th>
                  <th scope="col" className="numeric">End p (bar)</th>
                  <th scope="col" className="numeric">End gen (MWe)</th>
                  <th scope="col" className="numeric">Cum. gen (GWh)</th>
                  <th scope="col" className="numeric">Years to floor</th>
                </tr>
              </thead>
              <tbody>
                {model.outlooks.map((o) => (
                  <tr key={o.id}>
                    <th scope="row">{o.label}{o.result.deterministic.truncated ? ' †' : ''}</th>
                    <td className="numeric tabular">{formatNumber(o.outlook.endTemperatureC, 1)}</td>
                    <td className="numeric tabular">{formatNumber(o.outlook.endPressureBar, 1)}</td>
                    <td className="numeric tabular">{formatNumber(o.outlook.endGenerationMWe, 2)}</td>
                    <td className="numeric tabular">{formatNumber(o.outlook.cumulativeGenerationGWh, 0)}</td>
                    <td className="numeric tabular">
                      {o.outlook.yearsToPressureFloor === null ? '—' : formatNumber(o.outlook.yearsToPressureFloor, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">† forecast stopped early on depletion. “Years to floor” is null beyond the horizon.</p>
          </div>

          <div className="panel">
            <h2>Alerts and diagnostics</h2>
            {model.alerts.length === 0 ? (
              <p className="note">No alerts: decline rates, floor margins, telemetry gaps and filter confidence all within bounds.</p>
            ) : (
              <table className="data-table">
                <caption className="visually-hidden">Operational alerts</caption>
                <thead>
                  <tr>
                    <th scope="col">Severity</th>
                    <th scope="col">Alert</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {model.alerts.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.severity}</th>
                      <td>{a.title}</td>
                      <td>{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="note">
              Rules are fixed documented thresholds over twin cycles, telemetry quality and the
              baseline forecast — interpretation aids, not protection logic.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
