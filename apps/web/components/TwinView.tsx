'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  assimilation,
  dynamics,
  telemetry,
  type ParameterKey,
  type ParameterSpec,
} from '@geo/core';
import { TimeSeriesChart } from './TimeSeriesChart';
import { formatNumber } from '../lib/format';

const ENSEMBLE_OPTIONS = [25, 50, 100];
const INTERVAL_OPTIONS = [6, 12, 24];

/**
 * Digital-twin prototype view (Phase 2).
 *
 * A thin shell over `core/src/assimilation`: the experiment (truth, ensemble,
 * EnKF cycles, free-run control) runs in the core; observation points for the
 * charts come from `telemetry.observeTrajectory` on the truth trajectory.
 * The only arithmetic here is display slicing — no filtering math, no physics.
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
      return { result, obs, schedule, error: null as string | null };
    } catch (error) {
      return {
        result: null,
        obs: null,
        schedule: null,
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

  const last = model.result?.cycles[model.result.cycles.length - 1];
  const reductionT =
    model.result && Number.isFinite(model.result.errorRatioT)
      ? (1 - model.result.errorRatioT) * 100
      : NaN;
  // Innovation coverage: share of temperature innovations inside the expected
  // 2-sigma envelope. Display arithmetic over recorded diagnostics.
  const coverageCycles = model.result?.cycles.filter(
    (c) => c.innovT !== null && c.innovStdT !== null && c.innovStdT > 0,
  ) ?? [];
  const coverage =
    coverageCycles.length > 0
      ? coverageCycles.filter((c) => Math.abs(c.innovT!) <= 2 * c.innovStdT!).length /
        coverageCycles.length
      : NaN;

  return (
    <div className="stack">
      <div className="panel">
        <h2>Digital-twin prototype</h2>
        <p className="panel__intro">
          Hidden truth → synthetic telemetry → ensemble forecast → EnKF update → new
          forecast. The truth runs at most-likely parameters; the ensemble samples full
          parameter uncertainty <em>plus</em> an intentional initial-temperature bias,
          then yearly wellhead readings pull it back. A parallel free run (no
          assimilation) is the control — the experiment succeeds when the posterior
          tracks truth better than the free forecast. Reduced-order synthetic
          prototype, not a production estimator (assimilation version{' '}
          {assimilation.ASSIMILATION_VERSION}).
        </p>
        <p className="note">
          State vector is [temperature, pressure, fluid mass]; energy and generation
          are rebuilt from the posterior, never estimated. Generation readings are
          shown but not assimilated — folding the same rate information back through
          a nonlinear operator would add opacity for no gain.
        </p>
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
        <p className="note">
          Seed {seed} · deterministic — same seed reproduces truth, telemetry, filter
          noise and the free-run control exactly.
        </p>
      </div>

      {model.error || !model.result || !last ? (
        <div className="alert" role="alert">
          <strong>The twin experiment could not run.</strong>
          <p>{model.error ?? 'No result to display.'}</p>
        </div>
      ) : (
        <main className={busy ? 'is-stale' : undefined}>
          <dl className="tiles">
            <div className="tile">
              <dt>Final T error: posterior</dt>
              <dd><span className="tile__value tabular">{formatNumber(last.postErrT, 2)}</span><span className="tile__unit">°C</span></dd>
              <p className="tile__note">Free run: {formatNumber(last.freeErrT, 2)} °C</p>
            </div>
            <div className="tile">
              <dt>Error reduction (T)</dt>
              <dd><span className="tile__value tabular">{formatNumber(reductionT, 1)}</span><span className="tile__unit">%</span></dd>
              <p className="tile__note">1 − posterior/free at final cycle</p>
            </div>
            <div className="tile">
              <dt>Final p error: posterior</dt>
              <dd><span className="tile__value tabular">{formatNumber(last.postErrP, 2)}</span><span className="tile__unit">bar</span></dd>
              <p className="tile__note">Free run: {formatNumber(last.freeErrP, 2)} bar</p>
            </div>
            <div className="tile">
              <dt>Spread T: start → end</dt>
              <dd><span className="tile__value tabular">{formatNumber(model.result.cycles[0]!.priorSpreadT, 1)} → {formatNumber(last.postSpreadT, 2)}</span><span className="tile__unit">°C</span></dd>
              <p className="tile__note">
                {last.members} members active · {model.result.totalFallbacks} forecast fallbacks
              </p>
            </div>
            <div className="tile">
              <dt>Innovations within 2σ</dt>
              <dd><span className="tile__value tabular">{formatNumber(coverage * 100, 0)}</span><span className="tile__unit">%</span></dd>
              <p className="tile__note">
                {coverageCycles.length} checked cycles · {model.result.analysisSkipped} skipped analyses
              </p>
            </div>
          </dl>

          <div className="grid-2">
            <TimeSeriesChart
              title="Temperature: truth, forecast, posterior"
              yLabel="Temperature (°C)"
              lines={[
                { label: 'True state', points: model.result.truth.map((s) => ({ t: s.timeYears, value: s.temperatureC })) },
                { label: 'Free forecast mean', points: model.result.freeMean.map((s) => ({ t: s.timeYears, value: s.temperatureC })) },
                { label: 'Posterior mean', points: model.result.posteriorMean.map((s) => ({ t: s.timeYears, value: s.temperatureC })) },
                { label: 'Observations', points: obsSeries('temperatureC') },
              ]}
              digits={1}
              caption="Yearly noisy wellhead readings drag the biased ensemble back to the hidden truth; the free run keeps its bias."
            />
            <TimeSeriesChart
              title="Pressure: truth, forecast, posterior"
              yLabel="Pressure (bar)"
              lines={[
                { label: 'True state', points: model.result.truth.map((s) => ({ t: s.timeYears, value: s.pressureBar })) },
                { label: 'Free forecast mean', points: model.result.freeMean.map((s) => ({ t: s.timeYears, value: s.pressureBar })) },
                { label: 'Posterior mean', points: model.result.posteriorMean.map((s) => ({ t: s.timeYears, value: s.pressureBar })) },
                { label: 'Observations', points: obsSeries('pressureBar') },
              ]}
              digits={1}
              caption="Pressure is corrected mostly through its covariance with temperature and mass — it has its own readings too."
            />
          </div>
          <div className="grid-2">
            <TimeSeriesChart
              title="Generation: prediction vs observation vs posterior"
              yLabel="Capacity (MWe)"
              lines={[
                { label: 'True state', points: model.result.truth.map((s) => ({ t: s.timeYears, value: s.capacityMweInstant })) },
                { label: 'Free forecast mean', points: model.result.freeMean.map((s) => ({ t: s.timeYears, value: s.capacityMweInstant })) },
                { label: 'Posterior mean', points: model.result.posteriorMean.map((s) => ({ t: s.timeYears, value: s.capacityMweInstant })) },
                { label: 'Observations', points: obsSeries('generationMWe') },
              ]}
              caption="Diagnostic only: generation is rebuilt from each estimated state, never assimilated. Observation gaps read as breaks."
            />
            <TimeSeriesChart
              title="Mean absolute error over cycles"
              yLabel="Error (°C)"
              lines={[
                { label: 'Prior (pre-analysis)', points: cycleLine((c) => c.priorErrT) },
                { label: 'Posterior', points: cycleLine((c) => c.postErrT) },
                { label: 'Free run', points: cycleLine((c) => c.freeErrT) },
              ]}
              digits={1}
              caption="Ensemble-mean error against truth at each cycle. The posterior sawtooth — forecast drift, then correction — is the filter working."
            />
          </div>
          <TimeSeriesChart
            title="Temperature innovation vs expected envelope"
            yLabel="Innovation (°C)"
            lines={[
              { label: 'Innovation (obs − prior)', points: cycleLine((c) => c.innovT) },
              { label: '+2σ expected', points: cycleLine((c) => (c.innovStdT === null ? null : 2 * c.innovStdT)) },
              { label: '−2σ expected', points: cycleLine((c) => (c.innovStdT === null ? null : -2 * c.innovStdT)) },
            ]}
            digits={1}
            caption="Residual the filter actually saw, against the spread it expected. Mostly inside the envelope means the uncertainty is honest; persistent excursions would mean overconfidence."
          />

          <p className="note">
            {model.result.cycles.length - 1} assimilation cycles · seed {model.result.seed} ·
            model v{model.result.modelVersion} / dynamics v{model.result.dynamicsVersion} /
            assimilation v{model.result.assimilationVersion} ·{' '}
            {model.result.rejectedAssimilated + model.result.rejectedFree} exhausted members
            dropped across both runs · {model.result.analysisSkipped} skipped analyses ·{' '}
            missing readings skipped per cycle.
          </p>
        </main>
      )}
    </div>
  );
}
