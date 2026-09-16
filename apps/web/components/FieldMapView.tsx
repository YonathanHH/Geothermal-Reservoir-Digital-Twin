'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  assimilation,
  dynamics,
  spatial,
  telemetry,
  type ParameterKey,
  type ParameterSpec,
} from '@geo/core';
import { TimeSeriesChart } from './TimeSeriesChart';
import { formatNumber } from '../lib/format';

const ENSEMBLE_OPTIONS = [25, 50, 100];
const GRID_NX = 28;
const GRID_NY = 22;
const MAP_W = 660;
const MAP_H = 470;
const MAP_PAD = 30;

// Sequential color ramps (light → dark). Stops as [r, g, b].
const RAMP_T: [number, number, number][] = [[255, 247, 224], [253, 184, 99], [215, 48, 31]];
const RAMP_P: [number, number, number][] = [[235, 246, 255], [107, 174, 214], [8, 81, 156]];

function rampColor(stops: [number, number, number][], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const seg = Math.min(stops.length - 2, Math.floor(clamped * (stops.length - 1)));
  const f = clamped * (stops.length - 1) - seg;
  const a = stops[seg]!;
  const b = stops[seg + 1]!;
  const mix = (i: 0 | 1 | 2): number => Math.round(a[i] + (b[i] - a[i]) * f);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/**
 * Field map workspace (Phase 3).
 *
 * A thin shell over `core/src/spatial` + `core/src/assimilation`: one twin
 * run gives truth and posterior-mean bulk trajectories, the spatial layer
 * disaggregates both onto wells and a plan-view grid, and wellhead
 * surveillance is observed per cycle. Display slicing only — no physics,
 * no filtering math in this file.
 */
export function FieldMapView({
  parameters,
  seed,
}: {
  parameters: Record<ParameterKey, ParameterSpec>;
  seed: number;
}) {
  const [ensembleN, setEnsembleN] = useState(50);
  const [cycleIdx, setCycleIdx] = useState(30);
  const [layer, setLayer] = useState<'temperatureC' | 'pressureBar'>('temperatureC');
  const [source, setSource] = useState<'estimated' | 'true'>('estimated');
  const [selectedWell, setSelectedWell] = useState<string>('P-01');

  const deferred = useDeferredValue({ parameters, seed, ensembleN });
  const busy =
    deferred.parameters !== parameters || deferred.seed !== seed || deferred.ensembleN !== ensembleN;

  const model = useMemo(() => {
    try {
      const schedule = dynamics.defaultSchedule();
      const layout = spatial.defaultFieldLayout(
        deferred.parameters.A.mostLikely,
        deferred.seed,
        undefined,
        deferred.parameters.D.mostLikely,
      );
      const result = assimilation.runTwinExperiment({
        n: deferred.ensembleN,
        seed: deferred.seed,
        parameters: deferred.parameters,
        schedule,
      });
      const controlsAt = (s: number): { productionKgS: number; injectionKgS: number; injectionTemperatureC: number } => {
        const c = dynamics.controlsAt(schedule, Math.min(s, dynamics.TOTAL_STEPS - 1));
        return { productionKgS: c.productionKgS, injectionKgS: c.injectionKgS, injectionTemperatureC: c.injectionTemperatureC };
      };
      const params = { ...spatial.DEFAULT_SPATIAL_PARAMS };
      // Per-cycle snapshots for truth and posterior-mean bulk states.
      const truthSnapshots = result.cycles.map((c) =>
        spatial.wellConditions(
          { temperatureC: c.truthT, pressureBar: c.truthP },
          layout,
          { productionKgS: schedule.controls.productionKgS, injectionKgS: schedule.controls.injectionKgS },
          schedule.controls.injectionTemperatureC,
          params,
          c.timeYears,
        ),
      );
      const estSnapshots = result.cycles.map((c) =>
        spatial.wellConditions(
          { temperatureC: c.postMeanT, pressureBar: c.postMeanP },
          layout,
          { productionKgS: schedule.controls.productionKgS, injectionKgS: schedule.controls.injectionKgS },
          schedule.controls.injectionTemperatureC,
          params,
          c.timeYears,
        ),
      );
      // Wellhead surveillance on the truth snapshots, one observation per cycle.
      const sensors = {
        temperatureC: { ...telemetry.DEFAULT_TELEMETRY_CONFIG.channels.temperatureC },
        pressureBar: { ...telemetry.DEFAULT_TELEMETRY_CONFIG.channels.pressureBar },
      };
      const obsByCycle = truthSnapshots.map((snap, i) =>
        spatial.observeWells(
          layout.wells,
          snap,
          sensors,
          deferred.seed,
          result.cycles[i]!.stepIndex,
          result.cycles[i]!.timeYears,
        ),
      );
      return { result, layout, schedule, params, truthSnapshots, estSnapshots, obsByCycle, error: null as string | null };
    } catch (error) {
      return {
        result: null,
        layout: null,
        schedule: null,
        params: null,
        truthSnapshots: null,
        estSnapshots: null,
        obsByCycle: null,
        error: error instanceof Error ? error.message : 'The field map could not be built.',
      };
    }
  }, [deferred]);

  if (model.error || !model.result || !model.layout || !model.truthSnapshots || !model.estSnapshots || !model.obsByCycle) {
    return (
      <div className="stack">
        <div className="alert" role="alert">
          <strong>The field map could not be built.</strong>
          <p>{model.error ?? 'No result to display.'}</p>
        </div>
      </div>
    );
  }

  const { result, layout, truthSnapshots, estSnapshots, obsByCycle } = model;
  const nCycles = result.cycles.length;
  const ci = Math.max(0, Math.min(cycleIdx, nCycles - 1));
  const cycle = result.cycles[ci]!;
  const shownTruth = truthSnapshots[ci]!;
  const shownEst = estSnapshots[ci]!;
  const shown = source === 'estimated' ? shownEst : shownTruth;
  const shownObs = obsByCycle[ci]!;

  // Fixed color domains from the full run so the slider never flickers.
  const allVals = (pick: (c: spatial.WellConditions) => number): number[] => [
    ...truthSnapshots.flatMap((s) => s.map(pick)),
    ...estSnapshots.flatMap((s) => s.map(pick)),
  ];
  const layerVals = allVals((c) => (layer === 'temperatureC' ? c.temperatureC : c.pressureBar));
  const lo = Math.min(...layerVals);
  const hi = Math.max(...layerVals);
  const span = hi - lo || 1;

  // Heatmap grid for the displayed source at the slider step.
  const grid = spatial.fieldGrid(
    source === 'estimated'
      ? { temperatureC: cycle.postMeanT, pressureBar: cycle.postMeanP }
      : { temperatureC: cycle.truthT, pressureBar: cycle.truthP },
    layout,
    { productionKgS: model.schedule!.controls.productionKgS, injectionKgS: model.schedule!.controls.injectionKgS },
    model.schedule!.controls.injectionTemperatureC,
    model.params!,
    GRID_NX,
    GRID_NY,
  );

  const scale = Math.min(
    (MAP_W - 2 * MAP_PAD) / (2 * layout.boundary.radiusXM),
    (MAP_H - 2 * MAP_PAD) / (2 * layout.boundary.radiusYM),
  );
  const px = (xM: number): number => MAP_W / 2 + xM * scale;
  const py = (yM: number): number => MAP_H / 2 - yM * scale;
  const cellW = ((2 * layout.boundary.radiusXM) / (GRID_NX - 1)) * scale;
  const cellH = ((2 * layout.boundary.radiusYM) / (GRID_NY - 1)) * scale;
  const ramp = layer === 'temperatureC' ? RAMP_T : RAMP_P;
  const cellVal = (c: spatial.FieldCell): number =>
    layer === 'temperatureC' ? c.temperatureC : c.pressureBar;

  const wellById = new Map(layout.wells.map((w) => [w.id, w]));
  const validWell = wellById.get(selectedWell) ?? layout.wells[0]!;

  // Selected-well series across cycles: true vs observed (gaps) vs estimated.
  const wellSeries = (
    which: 'true' | 'obs' | 'est',
  ): { t: number; value: number | null }[] => {
    const channel = layer;
    return result.cycles.map((c, i) => {
      if (which === 'obs') {
        const o = obsByCycle[i]!.find((p) => p.wellId === validWell.id && p.channel === channel);
        return { t: c.timeYears, value: o?.observedValue ?? null };
      }
      const snap = (which === 'true' ? truthSnapshots : estSnapshots)[i]!;
      const wc = snap.find((s) => s.wellId === validWell.id)!;
      return { t: c.timeYears, value: channel === 'temperatureC' ? wc.temperatureC : wc.pressureBar };
    });
  };

  const flowing = layout.wells.filter((w) => w.status === 'flowing').length;
  const unit = layer === 'temperatureC' ? '°C' : 'bar';

  return (
    <div className="stack">
      <div className="panel">
        <h2>Field map — synthetic geothermal field</h2>
        <p className="panel__intro">
          The lumped tank disaggregated onto wells: producers draw down around
          themselves, peripheral injectors mound pressure back and cool their
          neighbours, the observation well reads bulk conditions. Colors show the{' '}
          <strong>{source === 'estimated' ? 'estimated' : 'true'}</strong> state at the
          slider time — estimated comes from the assimilation posterior, true from
          the hidden trajectory. Reduced-order illustration, not flow simulation
          (spatial version {spatial.SPATIAL_VERSION}).
        </p>
        <p className="note">
          Seed {seed} · layout v{layout.layoutVersion} · {layout.wells.length} wells
          ({flowing} flowing) · default operating rates · {nCycles - 1} yearly snapshots.
        </p>
      </div>

      <div className="panel">
        <h2>Map controls</h2>
        <div className="controls">
          <div className="control">
            <label htmlFor="fmap-time">Simulation time (years)</label>
            <input
              id="fmap-time"
              type="range"
              min={0}
              max={nCycles - 1}
              step={1}
              value={ci}
              onChange={(event) => setCycleIdx(Number(event.target.value))}
              aria-valuetext={`${formatNumber(cycle.timeYears, 1)} years`}
            />
            <span className="tabular">{formatNumber(cycle.timeYears, 1)} yr</span>
          </div>
          <div className="control">
            <label htmlFor="fmap-layer">Layer</label>
            <select id="fmap-layer" className="cell-input" value={layer}
              onChange={(event) => setLayer(event.target.value as typeof layer)}>
              <option value="temperatureC">Temperature (°C)</option>
              <option value="pressureBar">Pressure (bar)</option>
            </select>
          </div>
          <div className="control">
            <label htmlFor="fmap-source">Show</label>
            <select id="fmap-source" className="cell-input" value={source}
              onChange={(event) => setSource(event.target.value as typeof source)}>
              <option value="estimated">Estimated state</option>
              <option value="true">True state</option>
            </select>
          </div>
          <div className="control">
            <label htmlFor="fmap-well">Selected well</label>
            <select id="fmap-well" className="cell-input" value={validWell.id}
              onChange={(event) => setSelectedWell(event.target.value)}>
              {layout.wells.map((w) => (
                <option key={w.id} value={w.id}>{w.id} · {w.kind}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor="fmap-n">Ensemble members</label>
            <select id="fmap-n" className="cell-input" value={ensembleN}
              onChange={(event) => setEnsembleN(Number(event.target.value))}>
              {ENSEMBLE_OPTIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <span className="controls__status" role="status" aria-live="polite">{busy ? 'Recomputing…' : ''}</span>
        </div>
      </div>

      <main className={busy ? 'is-stale' : undefined}>
        <div className="panel">
          <h2>
            Reservoir {layer === 'temperatureC' ? 'temperature' : 'pressure'} —{' '}
            {source === 'estimated' ? 'estimated' : 'true'} state, year {formatNumber(cycle.timeYears, 1)}
          </h2>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="chart-svg" role="img"
            aria-label={`Field map of ${layer === 'temperatureC' ? 'temperature' : 'pressure'} at year ${formatNumber(cycle.timeYears, 1)}`}>
            {grid.map((c, i) =>
              c.inside ? (
                <rect key={i} x={px(c.xM) - cellW / 2} y={py(c.yM) - cellH / 2}
                  width={cellW + 0.5} height={cellH + 0.5}
                  fill={rampColor(ramp, (cellVal(c) - lo) / span)} opacity={0.55} />
              ) : null,
            )}
            <ellipse cx={MAP_W / 2} cy={MAP_H / 2}
              rx={layout.boundary.radiusXM * scale} ry={layout.boundary.radiusYM * scale}
              fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="6 4" />
            {layout.wells.map((w) => {
              const wc = shown.find((s) => s.wellId === w.id)!;
              const v = layer === 'temperatureC' ? wc.temperatureC : wc.pressureBar;
              const fill = rampColor(ramp, (v - lo) / span);
              const cx = px(w.xM);
              const cy = py(w.yM);
              const selected = w.id === validWell.id;
              const glyph =
                w.kind === 'production' ? (
                  <polygon points={`${cx},${cy - 9} ${cx - 8},${cy + 6} ${cx + 8},${cy + 6}`} />
                ) : w.kind === 'injection' ? (
                  <polygon points={`${cx},${cy + 9} ${cx - 8},${cy - 6} ${cx + 8},${cy - 6}`} />
                ) : (
                  <circle cx={cx} cy={cy} r={6} />
                );
              return (
                <g key={w.id} onClick={() => setSelectedWell(w.id)} style={{ cursor: 'pointer' }}>
                  <title>{`${w.name}: ${formatNumber(v, 1)} ${unit}, ${w.status}`}</title>
                  {selected ? (
                    <circle cx={cx} cy={cy} r={13} fill="none" stroke="var(--text)" strokeWidth={2} />
                  ) : null}
                  <g fill={fill} stroke="var(--text)" strokeWidth={1.5}>{glyph}</g>
                  <text x={cx} y={cy + 22} textAnchor="middle" fill="var(--text)" fontSize={11}
                    fontWeight={selected ? 700 : 400}>{w.id}</text>
                </g>
              );
            })}
          </svg>
          <p className="chart-frame__caption">
            ▲ producers · ▼ injectors · ● observation. Color runs {formatNumber(lo, 1)}–
            {formatNumber(hi, 1)} {unit} over the full run (fixed scale, no flicker).
            Dashed ellipse: reservoir boundary from area {formatNumber(layout.areaKm2, 1)} km².
          </p>
        </div>

        <div className="grid-2">
          <TimeSeriesChart
            title={`${validWell.id} · ${layer === 'temperatureC' ? 'Temperature' : 'Pressure'}: true vs observed vs estimated`}
            yLabel={layer === 'temperatureC' ? 'Temperature (°C)' : 'Pressure (bar)'}
            lines={[
              { label: 'True state', points: wellSeries('true') },
              { label: 'Observed', points: wellSeries('obs') },
              { label: 'Estimated state', points: wellSeries('est') },
            ]}
            digits={1}
            caption="Wellhead surveillance against the disaggregated truth and the assimilation posterior. Gaps are missing readings — never interpolated."
          />
          <div className="panel">
            <h2>Well table — year {formatNumber(cycle.timeYears, 1)} ({source})</h2>
            <table className="data-table">
              <caption className="visually-hidden">Well conditions at the slider time</caption>
              <thead>
                <tr>
                  <th scope="col">Well</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="numeric">Rate</th>
                  <th scope="col" className="numeric">Est. T</th>
                  <th scope="col" className="numeric">Est. p</th>
                  <th scope="col">Latest obs</th>
                </tr>
              </thead>
              <tbody>
                {layout.wells.map((w) => {
                  const est = shownEst.find((s) => s.wellId === w.id)!;
                  const obsT = shownObs.find((o) => o.wellId === w.id && o.channel === 'temperatureC');
                  const obsP = shownObs.find((o) => o.wellId === w.id && o.channel === 'pressureBar');
                  const obsText = (o: typeof obsT): string =>
                    !o || o.quality !== 'ok' ? (o?.quality ?? '—') : formatNumber(o.observedValue ?? NaN, 1);
                  return (
                    <tr key={w.id} onClick={() => setSelectedWell(w.id)}
                      style={{ cursor: 'pointer', fontWeight: w.id === validWell.id ? 700 : 400 }}>
                      <th scope="row">{w.id}</th>
                      <td>{w.kind}</td>
                      <td className="numeric tabular">{formatNumber(est.rateKgS, 1)} kg/s</td>
                      <td className="numeric tabular">{formatNumber(est.temperatureC, 1)} °C</td>
                      <td className="numeric tabular">{formatNumber(est.pressureBar, 1)}</td>
                      <td className="tabular">{obsText(obsT)} °C · {obsText(obsP)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="note">
              Estimated columns come from the posterior bulk state; “Latest obs” shows
              this step's surveillance (quality flag when not ok). Bulk truth T/p: {' '}
              {formatNumber(cycle.truthT, 1)} °C / {formatNumber(cycle.truthP, 1)} bar ·
              posterior: {formatNumber(cycle.postMeanT, 1)} °C / {formatNumber(cycle.postMeanP, 1)} bar.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
