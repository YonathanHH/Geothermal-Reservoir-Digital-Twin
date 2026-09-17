'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  dynamics,
  mostLikelyInputs,
  telemetry,
  type ParameterKey,
  type ParameterSpec,
} from '@geo/core';
import { TimeSeriesChart } from './TimeSeriesChart';
import { formatNumber } from '../lib/format';

const HORIZON_OPTIONS = [10, 20, 30];
const NOISE_OPTIONS = [
  { label: 'Perfect (none)', value: 0 },
  { label: 'Half', value: 0.5 },
  { label: 'Default', value: 1 },
  { label: 'Double', value: 2 },
];
const DROPOUT_OPTIONS = [
  { label: 'Default (~1%)', value: 'default' },
  { label: 'None', value: 'none' },
  { label: 'High (~5%)', value: 'high' },
] as const;
const STEPS_PER_YEAR = 12;

/**
 * Field telemetry workspace (Phase 1.5).
 *
 * A thin shell over `packages/core/src/telemetry/`: the trajectory comes from
 * `dynamics`, every reading from `telemetry.observeTrajectory`. The only
 * arithmetic here is display slicing — never reservoir physics, never sensor
 * statistics (RMSE/bias arrive precomputed in `run.diagnostics`).
 *
 * Two vocabularies stay visually separate throughout: RESERVOIR STATE (hidden
 * truth) vs FIELD TELEMETRY (what synthetic sensors report).
 */
export function TelemetryView({
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
  const [noiseLevel, setNoiseLevel] = useState(1);
  const [dropout, setDropout] = useState<(typeof DROPOUT_OPTIONS)[number]['value']>('default');

  const deferred = useDeferredValue({
    parameters,
    seed,
    productionKgS,
    injectionKgS,
    injectionTemperatureC,
    noiseLevel,
    dropout,
  });
  const busy =
    deferred.parameters !== parameters ||
    deferred.seed !== seed ||
    deferred.productionKgS !== productionKgS ||
    deferred.injectionKgS !== injectionKgS ||
    deferred.injectionTemperatureC !== injectionTemperatureC ||
    deferred.noiseLevel !== noiseLevel ||
    deferred.dropout !== dropout;

  const model = useMemo(() => {
    try {
      const schedule = dynamics.constantSchedule(
        deferred.productionKgS,
        deferred.injectionKgS,
        deferred.injectionTemperatureC,
      );
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
      const config = telemetry.cloneTelemetryConfig();
      for (const channel of telemetry.TELEMETRY_CHANNELS) {
        config.channels[channel].sigma *= deferred.noiseLevel;
        config.channels[channel].dropoutRate =
          deferred.dropout === 'none' ? 0 : deferred.dropout === 'high' ? 0.05 : config.channels[channel].dropoutRate;
      }
      const run = telemetry.observeTrajectory({
        states,
        controlsAt: telemetry.scheduleControlsForState(schedule),
        config,
        seed: deferred.seed,
        trajectoryIndex: 0,
      });
      return { states, schedule, run, error: null as string | null };
    } catch (error) {
      return {
        states: null,
        schedule: null,
        run: null,
        error: error instanceof Error ? error.message : 'The field model could not be evaluated.',
      };
    }
  }, [deferred]);

  const stepsToShow = horizonYears * STEPS_PER_YEAR;

  const truthOf = (
    channel: telemetry.TelemetryChannel,
  ): { t: number; value: number | null }[] | null => {
    if (!model.states) return null;
    return model.states.slice(0, stepsToShow + 1).map((s) => ({
      t: s.timeYears,
      value: channel === 'temperatureC'
        ? s.temperatureC
        : channel === 'pressureBar'
          ? s.pressureBar
          : channel === 'generationMWe'
            ? s.capacityMweInstant
            : channel === 'productionKgS'
              ? model.schedule!.controls.productionKgS
              : model.schedule!.controls.injectionKgS,
    }));
  };

  const observedOf = (
    channel: telemetry.TelemetryChannel,
  ): { t: number; value: number | null }[] => {
    if (!model.run) return [];
    const byStep = new Map(model.run.points.filter((p) => p.channel === channel).map((p) => [p.stepIndex, p]));
    const out: { t: number; value: number | null }[] = [];
    for (let s = 0; s <= stepsToShow; s++) {
      const p = byStep.get(s);
      out.push({ t: s / STEPS_PER_YEAR, value: p?.observedValue ?? null });
    }
    return out;
  };

  const last = model.states?.[stepsToShow];
  const nonOk = model.run?.points.filter((p) => p.quality !== 'ok' && p.stepIndex <= stepsToShow) ?? [];
  const totals = model.run
    ? {
        ok: model.run.points.filter((p) => p.quality === 'ok').length,
        missing: model.run.points.filter((p) => p.quality === 'missing').length,
        rejected: model.run.points.filter((p) => p.quality === 'rejected').length,
      }
    : null;

  return (
    <div className="stack">
      <div className="panel">
        <h2>Synthetic operating field</h2>
        <p className="panel__intro">
          Hidden reservoir state → sensor model → noise, bias and sampling → observed
          telemetry → state-estimation-ready records. One production well (<span className="symbol">PW-01</span>)
          and one plant; every reading below is <strong>synthetic</strong> — never real
          field data (telemetry version {telemetry.TELEMETRY_VERSION}).
        </p>
        <p className="note">
          Seed {seed} · deterministic — the same seed reproduces every reading exactly.
          Sensor streams are isolated from the reservoir sampling streams, so retuning a
          sensor never reshuffles the geology.
        </p>
      </div>

      <div className="panel">
        <h2>Field status</h2>
        {last && totals ? (
          <dl className="tiles">
            <div className="tile">
              <dt>Simulated time</dt>
              <dd><span className="tile__value tabular">{formatNumber(last.timeYears, 1)}</span><span className="tile__unit">yr</span></dd>
              <p className="tile__note">RESERVOIR STATE · hidden truth</p>
            </div>
            <div className="tile tile--hero" data-accent="estimate">
              <dt>Reservoir T / p</dt>
              <dd><span className="tile__value tile__value--sm tabular">{formatNumber(last.temperatureC, 1)} / {formatNumber(last.pressureBar, 1)}</span><span className="tile__unit">°C / bar</span></dd>
              <p className="tile__note">RESERVOIR STATE · hidden truth</p>
            </div>
            <div className="tile">
              <dt>Generation</dt>
              <dd><span className="tile__value tabular">{formatNumber(last.capacityMweInstant, 2)}</span><span className="tile__unit">MWe</span></dd>
              <p className="tile__note">PLANT · metered with noise</p>
            </div>
            <div className="tile">
              <dt>Readings ok / gaps</dt>
              <dd><span className="tile__value tabular">{totals.ok} / {totals.missing + totals.rejected}</span><span className="tile__unit">pts</span></dd>
              <p className="tile__note">FIELD TELEMETRY · quality counts</p>
            </div>
          </dl>
        ) : (
          <p className="empty-state">No field state to display.</p>
        )}
      </div>

      <div className="panel">
        <h2>Operating controls and sensors</h2>
        <div className="controls">
          <div className="control">
            <label htmlFor="tel-prod">Production rate (kg/s)</label>
            <input id="tel-prod" type="number" className="cell-input tabular" value={productionKgS} min={0}
              onChange={(event) => setProductionKgS(Number(event.target.value))} />
          </div>
          <div className="control">
            <label htmlFor="tel-inj">Injection rate (kg/s)</label>
            <input id="tel-inj" type="number" className="cell-input tabular" value={injectionKgS} min={0}
              onChange={(event) => setInjectionKgS(Number(event.target.value))} />
          </div>
          <div className="control">
            <label htmlFor="tel-tinj">Injection temperature (°C)</label>
            <input id="tel-tinj" type="number" className="cell-input tabular" value={injectionTemperatureC} min={1} max={349}
              onChange={(event) => setInjectionTemperatureC(Number(event.target.value))} />
          </div>
          <div className="control">
            <label htmlFor="tel-horizon">Horizon (years)</label>
            <select id="tel-horizon" className="cell-input" value={horizonYears}
              onChange={(event) => setHorizonYears(Number(event.target.value))}>
              {HORIZON_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="control">
            <label htmlFor="tel-noise">Sensor noise</label>
            <select id="tel-noise" className="cell-input" value={noiseLevel}
              onChange={(event) => setNoiseLevel(Number(event.target.value))}>
              {NOISE_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="control">
            <label htmlFor="tel-drop">Dropouts</label>
            <select id="tel-drop" className="cell-input" value={dropout}
              onChange={(event) => setDropout(event.target.value as typeof dropout)}>
              {DROPOUT_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <span className="controls__status" role="status" aria-live="polite">{busy ? 'Recomputing…' : ''}</span>
        </div>
        <p className="note">
          Noise scales the default meter accuracies (T ±1.5 °C, p ±0.8 bar, rates ±1 kg/s,
          power ±0.15 MWe). “Perfect” reproduces hidden truth exactly.
        </p>
      </div>

      {model.error || !model.run ? (
        <div className="alert" role="alert">
          <strong>The field model is outside its domain of validity.</strong>
          <p>{model.error ?? 'No telemetry to display.'}</p>
        </div>
      ) : (
        <main className={busy ? 'is-stale' : undefined}>
          <h2 className="visually-hidden">Production well PW-01</h2>
          <div className="grid-2">
            <TimeSeriesChart
              title="PW-01 · Reservoir temperature: truth vs telemetry"
              yLabel="Temperature (°C)"
              lines={[
                { label: 'True state', points: truthOf('temperatureC') ?? [] },
                { label: 'Observed', points: observedOf('temperatureC') },
              ]}
              digits={1}
              caption="Gaps are missing or rejected readings — never interpolated."
            />
            <TimeSeriesChart
              title="PW-01 · Reservoir pressure: truth vs telemetry"
              yLabel="Pressure (bar)"
              lines={[
                { label: 'True state', points: truthOf('pressureBar') ?? [] },
                { label: 'Observed', points: observedOf('pressureBar') },
              ]}
              digits={1}
              caption="Meter noise around the storage-driven decline."
            />
          </div>
          <div className="grid-2">
            <TimeSeriesChart
              title="Plant · Generation: truth vs telemetry"
              yLabel="Capacity (MWe)"
              lines={[
                { label: 'True state', points: truthOf('generationMWe') ?? [] },
                { label: 'Observed', points: observedOf('generationMWe') },
              ]}
              caption="Plant meter on instantaneous generation."
            />
            <TimeSeriesChart
              title="Flow meters: setpoint vs telemetry"
              yLabel="Rate (kg/s)"
              lines={[
                { label: 'Production setpoint', points: truthOf('productionKgS') ?? [] },
                { label: 'Production observed', points: observedOf('productionKgS') },
                { label: 'Injection setpoint', points: truthOf('injectionKgS') ?? [] },
                { label: 'Injection observed', points: observedOf('injectionKgS') },
              ]}
              digits={1}
              caption="Meters observe the setpoint with noise — the meter never sees the dial exactly."
            />
          </div>

          <div className="panel">
            <h2>Sensor health and accuracy</h2>
            <p className="panel__intro">
              Residual = observed − true over usable readings. RMSE should sit near the
              configured σ when the sensor is unbiased — the check a Phase-2 estimator
              will rely on.
            </p>
            <table className="data-table">
              <caption className="visually-hidden">Per-channel telemetry diagnostics</caption>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="numeric">Ok</th>
                  <th scope="col" className="numeric">Missing</th>
                  <th scope="col" className="numeric">Rejected</th>
                  <th scope="col" className="numeric">RMSE</th>
                  <th scope="col" className="numeric">Mean residual</th>
                </tr>
              </thead>
              <tbody>
                {model.run.diagnostics.map((d) => (
                  <tr key={d.channel}>
                    <th scope="row">{d.channel} <span className="unit">({d.unit})</span></th>
                    <td>{telemetry.TELEMETRY_SOURCES[d.channel]}</td>
                    <td className="numeric tabular">{d.nOk}</td>
                    <td className="numeric tabular">{d.nMissing}</td>
                    <td className="numeric tabular">{d.nRejected}</td>
                    <td className="numeric tabular">{formatNumber(d.rmse ?? NaN, 3)}</td>
                    <td className="numeric tabular">{formatNumber(d.meanResidual ?? NaN, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {nonOk.length > 0 ? (
            <div className="panel">
              <h2>Missing and rejected readings</h2>
              <p className="panel__intro">
                The reservoir keeps running; only the record has gaps. Each gap carries
                its step, channel and reason.
              </p>
              <table className="data-table">
                <caption className="visually-hidden">Non-ok telemetry points</caption>
                <thead>
                  <tr>
                    <th scope="col">Time (yr)</th>
                    <th scope="col">Channel</th>
                    <th scope="col">Source</th>
                    <th scope="col">Quality</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {nonOk.slice(0, 8).map((p, i) => (
                    <tr key={`${p.stepIndex}-${p.channel}-${i}`}>
                      <th scope="row" className="tabular">{formatNumber(p.timeYears, 2)}</th>
                      <td>{p.channel}</td>
                      <td>{p.source}</td>
                      <td>{p.quality}</td>
                      <td>{p.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nonOk.length > 8 ? (
                <p className="note">Showing 8 of {nonOk.length} non-ok readings.</p>
              ) : null}
            </div>
          ) : (
            <p className="note">No gaps: every scheduled reading arrived usable in this horizon.</p>
          )}
        </main>
      )}
    </div>
  );
}
