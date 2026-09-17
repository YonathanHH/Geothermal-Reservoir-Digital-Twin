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

const ENSEMBLE_OPTIONS = [25, 50, 100];
const INTERVAL_OPTIONS = [6, 12, 24];
const FORECAST_YEARS = 10;
const FORECAST_MEMBERS = 20;

/**
 * Digital-twin workspace (Phase 2 + Phase 4 forecast branch).
 *
 * A thin shell over core assimilation, telemetry and operations: the twin
 * experiment supplies hidden truth, observations, estimates and controls; one
 * deterministic scenario forecast branches from the latest estimated state.
 * Only display slicing happens here.
 */
export function TwinView({
  parameters,
  seed,
}: {
  parameters: Record<ParameterKey, ParameterSpec>;
  seed: number;
}) {
  const [ensembleN, setEnsembleN] = useState(50);
  const [biasC, setBiasC] = useState(15);
  const [intervalSteps, setIntervalSteps] = useState(12);
  const [productionKgS, setProductionKgS] = useState(dynamics.DEFAULT_PRODUCTION_KG_S);
  const [injectionKgS, setInjectionKgS] = useState(dynamics.DEFAULT_INJECTION_KG_S);

  const deferred = useDeferredValue({
    parameters,
    seed,
    ensembleN,
    biasC,
    intervalSteps,
    productionKgS,
    injectionKgS,
  });
  const busy =
    deferred.parameters !== parameters ||
    deferred.seed !== seed ||
    deferred.ensembleN !== ensembleN ||
    deferred.biasC !== biasC ||
    deferred.intervalSteps !== intervalSteps ||
    deferred.productionKgS !== productionKgS ||
    deferred.injectionKgS !== injectionKgS;

  const model = useMemo(() => {
    try {
      const schedule = dynamics.constantSchedule(
        deferred.productionKgS,
        deferred.injectionKgS,
        dynamics.DEFAULT_INJECTION_TEMPERATURE_C,
      );
      const result = assimilation.runTwinExperiment({
        n: deferred.ensembleN,
        seed: deferred.seed,
        parameters: deferred.parameters,
        schedule,
        assimilationIntervalSteps: deferred.intervalSteps,
        initialTemperatureBiasC: deferred.biasC,
      });
      const obs = telemetry.observeTrajectory({
        states: result.truth,
        controlsAt: telemetry.scheduleControlsForState(schedule),
        config: telemetry.cloneTelemetryConfig(),
        seed: deferred.seed,
        trajectoryIndex: 0,
      });

      let forecast: ReturnType<typeof operations.forecastScenarioEnsemble> | null = null;
      let forecastError: string | null = null;
      try {
        const estimated = result.posteriorMean[result.posteriorMean.length - 1]!;
        const baseline =
          operations.OPERATIONS_SCENARIOS.find((scenario) => scenario.id === 'baseline') ??
          operations.OPERATIONS_SCENARIOS[0]!;
        const startStep = dynamics.TOTAL_STEPS - 1;
        const resolved = operations.resolveOperationsSchedule(schedule, baseline, startStep);
        const { staticColumns, dynamicColumns } = dynamics.sampleEnsembleColumns(
          FORECAST_MEMBERS,
          deferred.seed,
          deferred.parameters,
          dynamics.DEFAULT_DYNAMIC_PARAMETERS,
        );
        forecast = operations.forecastScenarioEnsemble({
          scenarioId: baseline.id,
          estimatedState: estimated,
          parameters: deferred.parameters,
          dynamicParameters: dynamics.DEFAULT_DYNAMIC_PARAMETERS,
          staticColumns,
          dynamicColumns,
          lifetimeYears: 30,
          schedule: resolved,
          startStep,
          nSteps: FORECAST_YEARS * 12,
        });
      } catch (error) {
        forecastError =
          error instanceof Error ? error.message : 'The updated forecast could not be calculated.';
      }
      return { result, obs, schedule, forecast, forecastError, error: null as string | null };
    } catch (error) {
      return {
        result: null,
        obs: null,
        schedule: null,
        forecast: null,
        forecastError: null as string | null,
        error: error instanceof Error ? error.message : 'The twin experiment could not run.',
      };
    }
  }, [deferred]);

  const obsSeries = (
    channel: telemetry.TelemetryChannel,
  ): { t: number; value: number | null }[] => {
    if (!model.obs || !model.result) return [];
    const byStep = new Map(
      model.obs.points.filter((p) => p.channel === channel).map((p) => [p.stepIndex, p]),
    );
    return model.result.truth.map((s, idx) => ({
      t: s.timeYears,
      value: byStep.get(idx)?.observedValue ?? null,
    }));
  };

  const cycleLine = (
    pick: (c: assimilation.TwinCycle) => number | null,
  ): { t: number; value: number | null }[] =>
    model.result?.cycles.map((c) => ({ t: c.timeYears, value: pick(c) })) ?? [];

  const seriesOf = (
    states: { timeYears: number; temperatureC: number; pressureBar: number; capacityMweInstant: number }[],
    pick: (s: (typeof states)[number]) => number,
  ) => states.map((s) => ({ t: s.timeYears, value: pick(s) }));

  const last = model.result?.cycles[model.result.cycles.length - 1];
  const reductionT =
    model.result && Number.isFinite(model.result.errorRatioT)
      ? (1 - model.result.errorRatioT) * 100
      : NaN;
  const reductionP =
    model.result && Number.isFinite(model.result.errorRatioP)
      ? (1 - model.result.errorRatioP) * 100
      : NaN;
  const coverageCycles = model.result?.cycles.filter(
    (c) => c.innovT !== null && c.innovStdT !== null && c.innovStdT > 0,
  ) ?? [];
  const coverage =
    coverageCycles.length > 0
      ? coverageCycles.filter((c) => Math.abs(c.innovT!) <= 2 * c.innovStdT!).length /
        coverageCycles.length
      : NaN;
  const updatedCycles = model.result?.cycles.filter((c) => c.channelsUsed.length > 0) ?? [];
  const latestUpdate = [...updatedCycles].reverse()[0] ?? null;
  const truthFinal = model.result?.truth[model.result.truth.length - 1];
  const estimatedFinal = model.result?.posteriorMean[model.result.posteriorMean.length - 1];
  const temperatureDiag = model.obs?.diagnostics.find((d) => d.channel === 'temperatureC');
  const pressureDiag = model.obs?.diagnostics.find((d) => d.channel === 'pressureBar');
  const generationDiag = model.obs?.diagnostics.find((d) => d.channel === 'generationMWe');
  const channelLabel = (channel: 'temperatureC' | 'pressureBar'): string =>
    channel === 'temperatureC' ? 'T' : 'p';
  const coverageText = (diag?: telemetry.ChannelDiagnostics): string =>
    diag && diag.n > 0 ? `${formatNumber((diag.nOk / diag.n) * 100, 1)}% usable` : 'No record';
  const forecastEnd = model.forecast?.deterministic.states[model.forecast.deterministic.states.length - 1];
  const branchYear = estimatedFinal?.timeYears ?? NaN;

  return (
    <div className="control-room">
      <div className="panel control-room__header">
        <div>
          <h2>Reservoir control room</h2>
          <p className="panel__intro">
            A synthetic validation twin: biased estimates are corrected with noisy
            wellhead observations, then the latest estimate starts a ten-year
            operating forecast. Truth is retained only to score the estimator.
          </p>
        </div>
        <p className="note">Synthetic twin · seed {seed} · reduced-order model</p>
      </div>

      <div className="panel">
        <h2>Experiment controls</h2>
        <div className="controls">
          <div className="control">
            <label htmlFor="twin-n">Ensemble members</label>
            <select
              id="twin-n"
              className="cell-input"
              value={ensembleN}
              onChange={(event) => setEnsembleN(Number(event.target.value))}
            >
              {ENSEMBLE_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor="twin-bias">Initial T bias (°C)</label>
            <input
              id="twin-bias"
              type="number"
              className="cell-input tabular"
              value={biasC}
              min={0}
              max={60}
              onChange={(event) => setBiasC(Number(event.target.value))}
            />
          </div>
          <div className="control">
            <label htmlFor="twin-interval">Assimilation every (steps)</label>
            <select
              id="twin-interval"
              className="cell-input"
              value={intervalSteps}
              onChange={(event) => setIntervalSteps(Number(event.target.value))}
            >
              {INTERVAL_OPTIONS.map((v) => (
                <option key={v} value={v}>{v === 12 ? `${v} (yearly)` : v}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor="twin-prod">Production (kg/s)</label>
            <input
              id="twin-prod"
              type="number"
              className="cell-input tabular"
              value={productionKgS}
              min={0}
              onChange={(event) => setProductionKgS(Number(event.target.value))}
            />
          </div>
          <div className="control">
            <label htmlFor="twin-inj">Injection (kg/s)</label>
            <input
              id="twin-inj"
              type="number"
              className="cell-input tabular"
              value={injectionKgS}
              min={0}
              onChange={(event) => setInjectionKgS(Number(event.target.value))}
            />
          </div>
          <span className="controls__status" role="status" aria-live="polite">
            {busy ? 'Recomputing…' : ''}
          </span>
        </div>
      </div>

      {model.error || !model.result || !last || !truthFinal || !estimatedFinal ? (
        <div className="alert" role="alert">
          <strong>The twin experiment could not run.</strong>
          <p>{model.error ?? 'No result to display.'}</p>
        </div>
      ) : (
        <main className={busy ? 'is-stale' : undefined}>
          <section aria-label="Current field status" className="status-strip">
            <div className="status-card status-card--hero">
              <h3>Reservoir state now · estimated</h3>
              <p className="status-card__value tabular">
                {formatNumber(estimatedFinal.temperatureC, 1)} <span>°C</span>
                {' · '}
                {formatNumber(estimatedFinal.pressureBar, 1)} <span>bar</span>
              </p>
              <p className="status-card__meta">
                Truth {formatNumber(truthFinal.temperatureC, 1)} °C /{' '}
                {formatNumber(truthFinal.pressureBar, 1)} bar · error reduced{' '}
                {formatNumber(reductionT, 1)}% (T) / {formatNumber(reductionP, 1)}% (p)
              </p>
            </div>
            <div className="status-card">
              <h3>Estimated generation now</h3>
              <p className="status-card__value tabular">
                {formatNumber(estimatedFinal.capacityMweInstant, 2)} <span>MWe</span>
              </p>
              <p className="status-card__meta">
                Rebuilt from estimated T/p, not directly estimated
              </p>
            </div>
            <div className="status-card">
              <h3>Operating setpoint now</h3>
              <p className="status-card__value tabular">
                {formatNumber(deferred.productionKgS, 1)} <span>/ {formatNumber(deferred.injectionKgS, 1)} kg/s</span>
              </p>
              <p className="status-card__meta">Production / injection — setpoints, not measurements</p>
            </div>
            <div className="status-card status-card--warn">
              <h3>Estimate uncertainty</h3>
              <p className="status-card__value tabular">
                ±{formatNumber(last.postSpreadT, 2)} <span>°C</span>
              </p>
              <p className="status-card__meta">
                Temperature ensemble spread · {last.members} active members, not calibrated confidence
              </p>
            </div>
            <div className="status-card">
              <h3>Assimilation status</h3>
              <p className="status-card__value">
                {latestUpdate ? `Updated · year ${formatNumber(latestUpdate.timeYears, 1)}` : 'No updates'}
              </p>
              <p className="status-card__meta">
                {latestUpdate
                  ? `Used ${latestUpdate.channelsUsed.map(channelLabel).join(' + ')} · ${updatedCycles.length} updates`
                  : `${model.result.analysisSkipped} skipped analyses`}
              </p>
            </div>
          </section>

          <div className="panel">
            <div className="panel__head">
              <h2>Updated forecast from the latest estimate</h2>
              <span className="role-chip role-chip--forecast">Forecast · +{FORECAST_YEARS} yr</span>
            </div>
            {model.forecast && forecastEnd ? (
              <>
                <dl className="tiles">
                  <div className="tile tile--hero" data-accent="ember">
                    <dt>Forecast generation, +{FORECAST_YEARS} years</dt>
                    <dd>
                      <span className="tile__value tabular">
                        {formatNumber(forecastEnd.capacityMweInstant, 2)}
                      </span>
                      <span className="tile__unit">MWe</span>
                    </dd>
                    <p className="tile__note">
                      Current rates held · {model.forecast.rejected} depleted members excluded
                    </p>
                  </div>
                  <div className="tile tile--hero" data-accent="ember">
                    <dt>Forecast pressure, +{FORECAST_YEARS} years</dt>
                    <dd>
                      <span className="tile__value tabular">
                        {formatNumber(forecastEnd.pressureBar, 1)}
                      </span>
                      <span className="tile__unit">bar</span>
                    </dd>
                    <p className="tile__note">
                      {model.forecast.deterministic.truncated
                        ? `Stopped early: ${model.forecast.deterministic.stopReason ?? 'depletion'}`
                        : `Branches at year ${formatNumber(branchYear, 1)}`}
                    </p>
                  </div>
                </dl>
                <div className="grid-2">
                  <TimeSeriesChart
                    title="Generation history and updated forecast"
                    yLabel="Capacity (MWe)"
                    currentTime={branchYear}
                    lines={[
                      { label: 'Hidden true state', role: 'truth', points: seriesOf(model.result.truth, (s) => s.capacityMweInstant) },
                      { label: 'Observed telemetry', role: 'observation', points: obsSeries('generationMWe') },
                      { label: 'Posterior mean (estimate)', role: 'estimate', points: seriesOf(model.result.posteriorMean, (s) => s.capacityMweInstant) },
                      { label: 'Updated forecast', role: 'forecast', points: seriesOf(model.forecast.deterministic.states, (s) => s.capacityMweInstant) },
                    ]}
                    band={{ label: 'Updated forecast', points: model.forecast.bands.generationMWe }}
                    caption={`History ends at year ${formatNumber(branchYear, 1)}; the dashed line continues under current operating rates. The shaded range is parameter-only P10–P90 uncertainty.`}
                  />
                  <TimeSeriesChart
                    title="Pressure history and updated forecast"
                    yLabel="Pressure (bar)"
                    currentTime={branchYear}
                    lines={[
                      { label: 'Hidden true state', role: 'truth', points: seriesOf(model.result.truth, (s) => s.pressureBar) },
                      { label: 'Observed telemetry', role: 'observation', points: obsSeries('pressureBar') },
                      { label: 'Posterior mean (estimate)', role: 'estimate', points: seriesOf(model.result.posteriorMean, (s) => s.pressureBar) },
                      { label: 'Updated forecast', role: 'forecast', points: seriesOf(model.forecast.deterministic.states, (s) => s.pressureBar) },
                    ]}
                    band={{ label: 'Updated forecast', points: model.forecast.bands.pressureBar }}
                    digits={1}
                    caption="The vertical marker is the forecast branch point. Uncertainty excludes posterior-state, model and control errors."
                  />
                </div>
              </>
            ) : (
              <p className="note">
                The historical twin below remains valid. {model.forecastError ?? 'No forecast available.'}
              </p>
            )}
          </div>

          <div className="grid-2">
            <TimeSeriesChart
              title="Temperature: hidden truth, observations and estimate"
              yLabel="Temperature (°C)"
              lines={[
                { label: 'Hidden true state', role: 'truth', points: model.result.truth.map((s) => ({ t: s.timeYears, value: s.temperatureC })) },
                { label: 'Observed telemetry', role: 'observation', points: obsSeries('temperatureC') },
                { label: 'Posterior mean (estimate)', role: 'estimate', points: model.result.posteriorMean.map((s) => ({ t: s.timeYears, value: s.temperatureC })) },
                { label: 'No-assimilation control', role: 'reference', points: model.result.freeMean.map((s) => ({ t: s.timeYears, value: s.temperatureC })) },
              ]}
              digits={1}
              caption="Noisy wellhead readings pull the intentionally biased estimate toward hidden truth. The grey control keeps its bias."
            />
            <TimeSeriesChart
              title="Pressure: hidden truth, observations and estimate"
              yLabel="Pressure (bar)"
              lines={[
                { label: 'Hidden true state', role: 'truth', points: model.result.truth.map((s) => ({ t: s.timeYears, value: s.pressureBar })) },
                { label: 'Observed telemetry', role: 'observation', points: obsSeries('pressureBar') },
                { label: 'Posterior mean (estimate)', role: 'estimate', points: model.result.posteriorMean.map((s) => ({ t: s.timeYears, value: s.pressureBar })) },
                { label: 'No-assimilation control', role: 'reference', points: model.result.freeMean.map((s) => ({ t: s.timeYears, value: s.pressureBar })) },
              ]}
              digits={1}
              caption="Pressure is corrected through its covariance with temperature and mass, plus its own observations."
            />
          </div>

          <div className="panel">
            <h2>Latest assimilation update</h2>
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">Estimation improvement at the latest update</caption>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col" className="numeric">Before update</th>
                    <th scope="col" className="numeric">After update</th>
                    <th scope="col" className="numeric">No-assimilation control</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Temperature estimation error (°C)</th>
                    <td className="numeric tabular">{formatNumber(last.priorErrT, 2)}</td>
                    <td className="numeric tabular">{formatNumber(last.postErrT, 2)}</td>
                    <td className="numeric tabular">{formatNumber(last.freeErrT, 2)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Pressure estimation error (bar)</th>
                    <td className="numeric tabular">{formatNumber(last.priorErrP, 2)}</td>
                    <td className="numeric tabular">{formatNumber(last.postErrP, 2)}</td>
                    <td className="numeric tabular">{formatNumber(last.freeErrP, 2)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Temperature ensemble spread (°C)</th>
                    <td className="numeric tabular">{formatNumber(last.priorSpreadT, 2)}</td>
                    <td className="numeric tabular">{formatNumber(last.postSpreadT, 2)}</td>
                    <td className="numeric tabular">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="note">
              Smaller after-update errors mean observations improved this estimate.
              Spread measures ensemble disagreement, not the probability that the
              estimate is correct. Residual coverage below is a consistency check,
              not another confidence score.
            </p>
          </div>

          <div className="grid-2">
            <TimeSeriesChart
              title="Estimation error over time"
              yLabel="Error (°C)"
              lines={[
                { label: 'Forecast before update', role: 'forecast', points: cycleLine((c) => c.priorErrT) },
                { label: 'Estimate after update', role: 'estimate', points: cycleLine((c) => c.postErrT) },
                { label: 'No-assimilation control', role: 'reference', points: cycleLine((c) => c.freeErrT) },
              ]}
              digits={1}
              caption="The sawtooth of forecast drift followed by correction is normal filter behaviour."
            />
            <TimeSeriesChart
              title="Temperature residuals against the expected range"
              yLabel="Residual (°C)"
              lines={[
                { label: 'Observed − forecast residual', role: 'observation', points: cycleLine((c) => c.innovT) },
                { label: '+2σ expected', role: 'reference', points: cycleLine((c) => (c.innovStdT === null ? null : 2 * c.innovStdT)) },
                { label: '−2σ expected', role: 'reference', points: cycleLine((c) => (c.innovStdT === null ? null : -2 * c.innovStdT)) },
              ]}
              digits={1}
              caption={`${formatNumber(coverage * 100, 0)}% of checked residuals fall inside ±2σ. Persistent excursions would indicate overconfidence.`}
            />
          </div>

          <div className="panel">
            <h2>Observation quality</h2>
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">Telemetry usability and accuracy</caption>
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col" className="numeric">Usable share</th>
                    <th scope="col" className="numeric">Missing</th>
                    <th scope="col" className="numeric">Rejected</th>
                    <th scope="col" className="numeric">RMSE</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Temperature (°C)', diag: temperatureDiag },
                    { label: 'Pressure (bar)', diag: pressureDiag },
                    { label: 'Generation (MWe)', diag: generationDiag },
                  ].map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td className="numeric tabular">{coverageText(row.diag)}</td>
                      <td className="numeric tabular">{row.diag ? row.diag.nMissing : '—'}</td>
                      <td className="numeric tabular">{row.diag ? row.diag.nRejected : '—'}</td>
                      <td className="numeric tabular">
                        {row.diag?.rmse === null || row.diag?.rmse === undefined
                          ? '—'
                          : formatNumber(row.diag.rmse, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Generation is displayed but not assimilated. Missing readings are
              skipped by cycle; rejected readings never enter the estimator.
            </p>
          </div>

          <details className="method-details">
            <summary>How this validation experiment works</summary>
            <p>
              Hidden truth uses most-likely parameters. Ensemble members sample
              full parameter uncertainty and start {formatNumber(deferred.biasC, 1)} °C
              too warm. Wellhead temperature and pressure observations correct the
              [temperature, pressure, fluid-mass] state; energy and generation are
              rebuilt from each posterior with the forward model. Seed {seed} makes
              truth, telemetry and filter noise exactly reproducible.
            </p>
            <p className="note">
              Model v{model.result.modelVersion} · dynamics v{model.result.dynamicsVersion} ·
              assimilation v{model.result.assimilationVersion} ·{' '}
              {model.result.rejectedAssimilated + model.result.rejectedFree} exhausted
              members dropped · {model.result.totalFallbacks} forecast fallbacks ·{' '}
              {model.result.analysisSkipped} skipped analyses.
            </p>
          </details>
        </main>
      )}
    </div>
  );
}
