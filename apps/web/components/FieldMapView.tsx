'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
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
const GRID_NX = 44;
const GRID_NY = 34;
const MAP_W = 720;
const MAP_H = 500;
const MAP_PAD = 34;

// Sequential reservoir ramps tuned for a dark basemap: cool/dark low end so the
// hot, pressurised field interior glows. Stops as [r, g, b].
const RAMP_T: [number, number, number][] = [[64, 30, 18], [214, 110, 44], [255, 214, 150]];
const RAMP_P: [number, number, number][] = [[10, 28, 54], [44, 120, 190], [186, 224, 248]];
const DIVERGE_NEG: [number, number, number] = [56, 140, 240];
const DIVERGE_MID: [number, number, number] = [22, 28, 34];
const DIVERGE_POS: [number, number, number] = [255, 122, 58];

type DisplayId = 'temperature' | 'pressure' | 'pressure-deviation' | 'cooling';

const DISPLAYS: {
  id: DisplayId;
  variable: 'temperatureC' | 'pressureBar';
  mode: 'absolute' | 'deviation';
  label: string;
  unit: string;
  explanation: string;
}[] = [
  {
    id: 'temperature',
    variable: 'temperatureC',
    mode: 'absolute',
    label: 'Reservoir temperature, absolute (°C)',
    unit: '°C',
    explanation: 'Bulk thermal history plus local injector cooling.',
  },
  {
    id: 'pressure',
    variable: 'pressureBar',
    mode: 'absolute',
    label: 'Reservoir pressure, absolute (bar)',
    unit: 'bar',
    explanation: 'Bulk depletion plus local production and injection cones.',
  },
  {
    id: 'pressure-deviation',
    variable: 'pressureBar',
    mode: 'deviation',
    label: 'Pressure deviation from bulk (bar)',
    unit: 'bar',
    explanation: 'Negative: production drawdown. Positive: injection support.',
  },
  {
    id: 'cooling',
    variable: 'temperatureC',
    mode: 'deviation',
    label: 'Local cooling relative to bulk (°C)',
    unit: '°C',
    explanation: 'Positive values are locally cooler than bulk reservoir fluid.',
  },
];

function mixChannel(a: number, b: number, f: number): number {
  return Math.round(a + (b - a) * f);
}

function rampColor(stops: [number, number, number][], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const seg = Math.min(stops.length - 2, Math.floor(clamped * (stops.length - 1)));
  const f = clamped * (stops.length - 1) - seg;
  const a = stops[seg]!;
  const b = stops[seg + 1]!;
  return `rgb(${mixChannel(a[0], b[0], f)}, ${mixChannel(a[1], b[1], f)}, ${mixChannel(a[2], b[2], f)})`;
}

function divergingColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped < 0.5) {
    const f = clamped / 0.5;
    return `rgb(${mixChannel(DIVERGE_NEG[0], DIVERGE_MID[0], f)}, ${mixChannel(DIVERGE_NEG[1], DIVERGE_MID[1], f)}, ${mixChannel(DIVERGE_NEG[2], DIVERGE_MID[2], f)})`;
  }
  const f = (clamped - 0.5) / 0.5;
  return `rgb(${mixChannel(DIVERGE_MID[0], DIVERGE_POS[0], f)}, ${mixChannel(DIVERGE_MID[1], DIVERGE_POS[1], f)}, ${mixChannel(DIVERGE_MID[2], DIVERGE_POS[2], f)})`;
}

/**
 * Field map workspace (Phase 3).
 *
 * A thin shell over core spatial, assimilation and surveillance records. Twin
 * bulk trajectories are disaggregated once and cached for every cycle and both
 * sources; the slider, source, display and well selectors only choose slices.
 * Deviation displays subtract recorded bulk values for readability and do not
 * recalculate reservoir physics.
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
  const [displayId, setDisplayId] = useState<DisplayId>('temperature');
  const [source, setSource] = useState<'estimated' | 'true'>('estimated');
  const [selectedWell, setSelectedWell] = useState<string>('P-01');
  const [showQuality, setShowQuality] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

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
      const truthBulk = result.cycles.map((c) => ({
        temperatureC: c.truthT,
        pressureBar: c.truthP,
        timeYears: c.timeYears,
      }));
      const estBulk = result.cycles.map((c) => ({
        temperatureC: c.postMeanT,
        pressureBar: c.postMeanP,
        timeYears: c.timeYears,
      }));
      const trueGrids = result.cycles.map((c) =>
        spatial.fieldGrid(
          { temperatureC: c.truthT, pressureBar: c.truthP },
          layout,
          { productionKgS: schedule.controls.productionKgS, injectionKgS: schedule.controls.injectionKgS },
          schedule.controls.injectionTemperatureC,
          params,
          GRID_NX,
          GRID_NY,
        ),
      );
      const estGrids = result.cycles.map((c) =>
        spatial.fieldGrid(
          { temperatureC: c.postMeanT, pressureBar: c.postMeanP },
          layout,
          { productionKgS: schedule.controls.productionKgS, injectionKgS: schedule.controls.injectionKgS },
          schedule.controls.injectionTemperatureC,
          params,
          GRID_NX,
          GRID_NY,
        ),
      );

      // Fixed display domains from recorded reservoir-grid cells, not well
      // markers. Injector markers can sit at injection temperature; including
      // them would compress the reservoir-scale contrast.
      let tempLo = Number.POSITIVE_INFINITY;
      let tempHi = Number.NEGATIVE_INFINITY;
      let pressLo = Number.POSITIVE_INFINITY;
      let pressHi = Number.NEGATIVE_INFINITY;
      let pressDevAbs = 0;
      let coolLo = Number.POSITIVE_INFINITY;
      let coolHi = Number.NEGATIVE_INFINITY;
      const grids: { grid: spatial.FieldCell[]; bulk: { temperatureC: number; pressureBar: number } }[] = [];
      for (let i = 0; i < result.cycles.length; i++) {
        grids.push({ grid: trueGrids[i]!, bulk: truthBulk[i]! });
        grids.push({ grid: estGrids[i]!, bulk: estBulk[i]! });
      }
      for (const entry of grids) {
        for (const cell of entry.grid) {
          if (!cell.inside) continue;
          tempLo = Math.min(tempLo, cell.temperatureC);
          tempHi = Math.max(tempHi, cell.temperatureC);
          pressLo = Math.min(pressLo, cell.pressureBar);
          pressHi = Math.max(pressHi, cell.pressureBar);
          pressDevAbs = Math.max(pressDevAbs, Math.abs(cell.pressureBar - entry.bulk.pressureBar));
          const cooling = entry.bulk.temperatureC - cell.temperatureC;
          coolLo = Math.min(coolLo, cooling);
          coolHi = Math.max(coolHi, cooling);
        }
      }
      return {
        result,
        layout,
        schedule,
        params,
        controlsAt,
        truthSnapshots,
        estSnapshots,
        obsByCycle,
        truthBulk,
        estBulk,
        trueGrids,
        estGrids,
        domains: {
          temperature: { lo: tempLo, hi: tempHi },
          pressure: { lo: pressLo, hi: pressHi },
          pressureDeviation: { lo: -pressDevAbs, hi: pressDevAbs },
          cooling: { lo: coolLo, hi: coolHi },
        },
        error: null as string | null,
      };
    } catch (error) {
      return {
        result: null,
        layout: null,
        schedule: null,
        params: null,
        controlsAt: null,
        truthSnapshots: null,
        estSnapshots: null,
        obsByCycle: null,
        truthBulk: null,
        estBulk: null,
        trueGrids: null,
        estGrids: null,
        domains: null,
        error: error instanceof Error ? error.message : 'The field map could not be built.',
      };
    }
  }, [deferred]);

  const nCycles = model.result?.cycles.length ?? 0;
  useEffect(() => {
    if (!isPlaying || nCycles === 0) return;
    if (cycleIdx >= nCycles - 1) {
      setIsPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      setCycleIdx((current) => {
        if (current >= nCycles - 1) {
          window.clearInterval(id);
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 650);
    return () => window.clearInterval(id);
  }, [isPlaying, nCycles, cycleIdx]);

  if (
    model.error ||
    !model.result ||
    !model.layout ||
    !model.truthSnapshots ||
    !model.estSnapshots ||
    !model.obsByCycle ||
    !model.truthBulk ||
    !model.estBulk ||
    !model.trueGrids ||
    !model.estGrids ||
    !model.domains ||
    nCycles === 0
  ) {
    return (
      <div className="stack">
        <div className="alert" role="alert">
          <strong>The field map could not be built.</strong>
          <p>{model.error ?? 'No result to display.'}</p>
        </div>
      </div>
    );
  }

  const { result, layout, truthSnapshots, estSnapshots, obsByCycle, truthBulk, estBulk } = model;
  const ci = Math.max(0, Math.min(cycleIdx, nCycles - 1));
  const cycle = result.cycles[ci]!;
  const display = DISPLAYS.find((d) => d.id === displayId) ?? DISPLAYS[0]!;
  const bulk = (source === 'estimated' ? estBulk : truthBulk)[ci]!;
  const shownTruth = truthSnapshots[ci]!;
  const shownEst = estSnapshots[ci]!;
  const shownObs = obsByCycle[ci]!;
  const grid = (source === 'estimated' ? model.estGrids : model.trueGrids)[ci]!;
  const domain =
    display.id === 'temperature'
      ? model.domains.temperature
      : display.id === 'pressure'
        ? model.domains.pressure
        : display.id === 'pressure-deviation'
          ? model.domains.pressureDeviation
          : model.domains.cooling;
  const domainSpan = domain.hi - domain.lo || 1;

  const cellDisplayValue = (cell: spatial.FieldCell): number => {
    if (display.mode === 'absolute') {
      return display.variable === 'temperatureC' ? cell.temperatureC : cell.pressureBar;
    }
    return display.variable === 'temperatureC'
      ? bulk.temperatureC - cell.temperatureC
      : cell.pressureBar - bulk.pressureBar;
  };

  const colorForDisplay = (value: number): string => {
    const t = (value - domain.lo) / domainSpan;
    if (display.id === 'pressure-deviation') return divergingColor(t);
    return rampColor(display.variable === 'temperatureC' ? RAMP_T : RAMP_P, t);
  };

  const scale = Math.min(
    (MAP_W - 2 * MAP_PAD) / (2 * layout.boundary.radiusXM),
    (MAP_H - 2 * MAP_PAD) / (2 * layout.boundary.radiusYM),
  );
  const px = (xM: number): number => MAP_W / 2 + xM * scale;
  const py = (yM: number): number => MAP_H / 2 - yM * scale;
  const cellW = ((2 * layout.boundary.radiusXM) / (GRID_NX - 1)) * scale;
  const cellH = ((2 * layout.boundary.radiusYM) / (GRID_NY - 1)) * scale;
  const scaleTargetM = ((2 * layout.boundary.radiusXM) / 5) || 1;
  const scaleMagnitude = 10 ** Math.floor(Math.log10(scaleTargetM));
  const scaleNormalized = scaleTargetM / scaleMagnitude;
  const scaleNiceM = (scaleNormalized >= 5 ? 5 : scaleNormalized >= 2 ? 2 : 1) * scaleMagnitude;
  const scaleLabel = scaleNiceM >= 1000 ? `${formatNumber(scaleNiceM / 1000, 1)} km` : `${formatNumber(scaleNiceM, 0)} m`;

  const wellById = new Map(layout.wells.map((w) => [w.id, w]));
  const validWell = wellById.get(selectedWell) ?? layout.wells[0]!;
  const trueWell = shownTruth.find((s) => s.wellId === validWell.id)!;
  const estWell = shownEst.find((s) => s.wellId === validWell.id)!;
  const wellRate = estWell.rateKgS;
  const obsTemp = shownObs.find((o) => o.wellId === validWell.id && o.channel === 'temperatureC');
  const obsPress = shownObs.find((o) => o.wellId === validWell.id && o.channel === 'pressureBar');

  const qualityOf = (wellId: string): 'ok' | 'missing' | 'rejected' => {
    const flags = shownObs
      .filter((o) => o.wellId === wellId)
      .map((o) => o.quality);
    if (flags.includes('rejected')) return 'rejected';
    if (flags.includes('missing')) return 'missing';
    return 'ok';
  };

  const observationText = (o?: spatial.WellObservation): string => {
    if (!o || o.observedValue === null) {
      return `${o?.quality ?? 'missing'}${o?.reason ? ` · ${o.reason}` : ''}`;
    }
    return `${formatNumber(o.observedValue, 1)} ${o.unit} · ${o.quality}`;
  };

  const wellSeries = (
    which: 'true' | 'obs' | 'est',
  ): { t: number; value: number | null }[] => {
    const channel = display.variable;
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

  const legendStops =
    display.id === 'pressure-deviation'
      ? 'rgb(56, 140, 240), rgb(22, 28, 34), rgb(255, 122, 58)'
      : (display.variable === 'temperatureC' ? RAMP_T : RAMP_P)
          .map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`)
          .join(', ');
  const legendMid = (domain.lo + domain.hi) / 2;
  const legendQ1 = domain.lo + domainSpan * 0.25;
  const legendQ3 = domain.lo + domainSpan * 0.75;
  const unit = display.unit;
  const flowing = layout.wells.filter((w) => w.status === 'flowing').length;

  return (
    <div className="control-room">
      <div className="panel control-room__header">
        <div>
          <h2>Field map — synthetic geothermal field</h2>
          <p className="panel__intro">
            A reduced-order spatial view of the twin: the tank bulk state is spread
            onto production, injection and observation wells with steady influence
            cones. Select a well for its true, observed and estimated history.
          </p>
        </div>
        <p className="note">
          Seed {seed} · {layout.wells.length} wells ({flowing} flowing) · default rates
        </p>
      </div>

      <div className="panel">
        <h2>Map and time controls</h2>
        <div className="controls">
          <div className="control">
            <label htmlFor="fmap-display">Spatial variable</label>
            <select
              id="fmap-display"
              className="cell-input"
              value={display.id}
              onChange={(event) => setDisplayId(event.target.value as DisplayId)}
            >
              {DISPLAYS.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor="fmap-source">Show</label>
            <select
              id="fmap-source"
              className="cell-input"
              value={source}
              onChange={(event) => setSource(event.target.value as typeof source)}
            >
              <option value="estimated">Estimated state</option>
              <option value="true">Hidden true state</option>
            </select>
          </div>
          <div className="control">
            <label htmlFor="fmap-well">Selected well</label>
            <select
              id="fmap-well"
              className="cell-input"
              value={validWell.id}
              onChange={(event) => setSelectedWell(event.target.value)}
            >
              {layout.wells.map((w) => (
                <option key={w.id} value={w.id}>{w.id} · {w.kind}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label htmlFor="fmap-n">Ensemble members</label>
            <select
              id="fmap-n"
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
            <span>
              <label>
                <input
                  type="checkbox"
                  checked={showQuality}
                  onChange={(event) => setShowQuality(event.target.checked)}
                />{' '}
                Show observation-quality rings
              </label>
            </span>
          </div>
          <span className="controls__status" role="status" aria-live="polite">{busy ? 'Recomputing…' : ''}</span>
        </div>
        <div className="timeline">
          <button
            type="button"
            className="button timeline__play"
            aria-pressed={isPlaying}
            onClick={() => {
              if (!isPlaying && ci >= nCycles - 1) setCycleIdx(0);
              setIsPlaying((current) => !current);
            }}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <label className="timeline__slider" htmlFor="fmap-time">
            Simulation time
            <input
              id="fmap-time"
              type="range"
              min={0}
              max={nCycles - 1}
              step={1}
              value={ci}
              onChange={(event) => {
                setIsPlaying(false);
                setCycleIdx(Number(event.target.value));
              }}
              aria-valuetext={`${formatNumber(cycle.timeYears, 1)} years`}
            />
          </label>
          <span className="timeline__readout tabular">
            Year {formatNumber(cycle.timeYears, 1)} · snapshot {ci + 1} of {nCycles}
          </span>
        </div>
        <p className="note">{display.explanation} Colour limits are fixed for the whole run.</p>
      </div>

      <main className={busy ? 'is-stale' : undefined}>
        <div className="map-workspace">
          <div className="panel map-stage">
            <div className="panel__head">
              <h2>
                {display.label} — {source === 'estimated' ? 'estimated' : 'hidden true'} state
              </h2>
              <span className={`role-chip ${source === 'estimated' ? 'role-chip--estimate' : 'role-chip--truth'}`}>
                {source === 'estimated' ? 'Estimate' : 'Hidden truth'}
              </span>
            </div>
            <div className="map-canvas">
            <svg
              viewBox={`0 0 ${MAP_W} ${MAP_H}`}
              className="chart-svg"
              role="img"
              aria-label={`${display.label}, ${source} state, year ${formatNumber(cycle.timeYears, 1)}`}
            >
              <defs>
                <clipPath id="field-boundary-clip">
                  <ellipse
                    cx={MAP_W / 2}
                    cy={MAP_H / 2}
                    rx={layout.boundary.radiusXM * scale}
                    ry={layout.boundary.radiusYM * scale}
                  />
                </clipPath>
              </defs>
              <g clipPath="url(#field-boundary-clip)">
                {grid.map((c, i) =>
                  c.inside ? (
                    <rect
                      key={i}
                      x={px(c.xM) - cellW / 2}
                      y={py(c.yM) - cellH / 2}
                      width={cellW + 0.6}
                      height={cellH + 0.6}
                      fill={colorForDisplay(cellDisplayValue(c))}
                    />
                  ) : null,
                )}
              </g>
              <ellipse
                cx={MAP_W / 2}
                cy={MAP_H / 2}
                rx={layout.boundary.radiusXM * scale}
                ry={layout.boundary.radiusYM * scale}
                fill="none"
                stroke="var(--surface-sunken)"
                strokeWidth={5}
              />
              <ellipse
                cx={MAP_W / 2}
                cy={MAP_H / 2}
                rx={layout.boundary.radiusXM * scale}
                ry={layout.boundary.radiusYM * scale}
                fill="none"
                stroke="var(--text-primary)"
                strokeWidth={2}
              />
              {/* Graticule: faint inner range rings + crosshair for spatial reference. */}
              <g fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="5 5" opacity={0.8} aria-hidden="true">
                <ellipse
                  cx={MAP_W / 2}
                  cy={MAP_H / 2}
                  rx={(layout.boundary.radiusXM * scale * 2) / 3}
                  ry={(layout.boundary.radiusYM * scale * 2) / 3}
                />
                <ellipse
                  cx={MAP_W / 2}
                  cy={MAP_H / 2}
                  rx={(layout.boundary.radiusXM * scale) / 3}
                  ry={(layout.boundary.radiusYM * scale) / 3}
                />
                <line
                  x1={MAP_W / 2 - layout.boundary.radiusXM * scale}
                  x2={MAP_W / 2 + layout.boundary.radiusXM * scale}
                  y1={MAP_H / 2}
                  y2={MAP_H / 2}
                />
                <line
                  x1={MAP_W / 2}
                  x2={MAP_W / 2}
                  y1={MAP_H / 2 - layout.boundary.radiusYM * scale}
                  y2={MAP_H / 2 + layout.boundary.radiusYM * scale}
                />
              </g>
              {layout.wells.map((w) => {
                const wc = (source === 'estimated' ? shownEst : shownTruth).find((s) => s.wellId === w.id)!;
                const raw = display.variable === 'temperatureC' ? wc.temperatureC : wc.pressureBar;
                const shownValue =
                  display.mode === 'absolute'
                    ? raw
                    : display.variable === 'temperatureC'
                      ? bulk.temperatureC - raw
                      : raw - bulk.pressureBar;
                const fill = colorForDisplay(shownValue);
                const cx = px(w.xM);
                const cy = py(w.yM);
                const selected = w.id === validWell.id;
                const quality = qualityOf(w.id);
                const glyph =
                  w.kind === 'production' ? (
                    <polygon points={`${cx},${cy - 11} ${cx - 10},${cy + 7.5} ${cx + 10},${cy + 7.5}`} />
                  ) : w.kind === 'injection' ? (
                    <polygon points={`${cx},${cy + 11} ${cx - 10},${cy - 7.5} ${cx + 10},${cy - 7.5}`} />
                  ) : (
                    <circle cx={cx} cy={cy} r={7.5} />
                  );
                return (
                  <g
                    key={w.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${w.name}, ${w.kind}, ${w.status}. ${display.label}: ${formatNumber(shownValue, 1)} ${unit}. Observation quality ${quality}. Activate to select.`}
                    onClick={() => setSelectedWell(w.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedWell(w.id);
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <title>{`${w.name}: ${formatNumber(shownValue, 1)} ${unit}, ${w.status}, quality ${quality}`}</title>
                    {showQuality && quality !== 'ok' ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={14}
                        fill="none"
                        stroke={quality === 'rejected' ? 'var(--critical)' : 'var(--series-4)'}
                        strokeWidth={2.5}
                        strokeDasharray={quality === 'rejected' ? undefined : '4 3'}
                      />
                    ) : null}
                    {selected ? (
                      <>
                        <circle cx={cx} cy={cy} r={18} fill="none" stroke="var(--ember)" strokeWidth={1.5} opacity={0.55} />
                        <circle cx={cx} cy={cy} r={14.5} fill="none" stroke="var(--ember)" strokeWidth={2.5} />
                      </>
                    ) : null}
                    <g fill={fill} stroke="var(--surface-sunken)" strokeWidth={2.5}>{glyph}</g>
                    <text
                      x={cx}
                      y={cy + 28}
                      textAnchor="middle"
                      fill="var(--text-primary)"
                      fontSize={12}
                      fontWeight={selected ? 700 : 400}
                    >
                      {w.id}
                    </text>
                  </g>
                );
              })}
              <g aria-hidden="true">
                <line
                  x1={MAP_PAD}
                  x2={MAP_PAD + scaleNiceM * scale}
                  y1={MAP_H - 12}
                  y2={MAP_H - 12}
                  stroke="var(--text-primary)"
                  strokeWidth={2}
                />
                <line x1={MAP_PAD} x2={MAP_PAD} y1={MAP_H - 16} y2={MAP_H - 8} stroke="var(--text-primary)" strokeWidth={2} />
                <line
                  x1={MAP_PAD + scaleNiceM * scale}
                  x2={MAP_PAD + scaleNiceM * scale}
                  y1={MAP_H - 16}
                  y2={MAP_H - 8}
                  stroke="var(--text-primary)"
                  strokeWidth={2}
                />
                <text x={MAP_PAD} y={MAP_H - 20} fill="var(--text-primary)" fontSize={11} className="tabular">
                  {scaleLabel}
                </text>
                <text x={MAP_W - MAP_PAD} y={MAP_PAD - 12} textAnchor="end" fill="var(--text-primary)" fontSize={11}>
                  N ↑
                </text>
              </g>
            </svg>
            </div>
            <div className="map-legend" aria-label={`${display.label} colour scale`}>
              <div className="map-legend__ramp" style={{ background: `linear-gradient(90deg, ${legendStops})` }} aria-hidden="true" />
              <div className="map-legend__ticks tabular">
                <span>{formatNumber(domain.lo, 1)} {unit}</span>
                <span>{formatNumber(legendQ1, 1)} {unit}</span>
                <span>{formatNumber(legendMid, 1)} {unit}</span>
                <span>{formatNumber(legendQ3, 1)} {unit}</span>
                <span>{formatNumber(domain.hi, 1)} {unit}</span>
              </div>
            </div>
            <ul className="well-key" aria-label="Well symbols and observation quality">
              <li><span className="well-key__glyph well-key__glyph--production" aria-hidden="true">▲</span>Production</li>
              <li><span className="well-key__glyph well-key__glyph--injection" aria-hidden="true">▼</span>Injection</li>
              <li><span className="well-key__glyph well-key__glyph--observation" aria-hidden="true">●</span>Observation</li>
              <li><span className="quality-badge quality-badge--missing">missing</span>&nbsp;Missing reading</li>
              <li><span className="quality-badge quality-badge--rejected">rejected</span>&nbsp;Rejected reading</li>
            </ul>
            <p className="chart-frame__caption">
              Fixed reservoir-grid scale: no colour flicker while time moves. Solid
              ellipse is the reservoir boundary for {formatNumber(layout.areaKm2, 1)} km².
              Injector markers outside the plotted reservoir range are clamped to the
              nearest endpoint.
            </p>
          </div>

          <div className="panel well-inspector">
            <div className="panel__head">
              <h2>Selected well — {validWell.id}</h2>
              <span className={`role-chip ${validWell.kind === 'production' ? 'role-chip--forecast' : validWell.kind === 'injection' ? 'role-chip--truth' : 'role-chip--estimate'}`}>
                {validWell.kind}
              </span>
            </div>
            <p className="note">{validWell.name} · {validWell.kind} · {validWell.status} · depth {formatNumber(validWell.depthM, 0)} m</p>
            <div className="table-scroll">
              <table className="data-table">
                <caption className="visually-hidden">True, observed and estimated conditions at the selected time</caption>
                <thead>
                  <tr>
                    <th scope="col">Signal</th>
                    <th scope="col" className="numeric">Hidden true</th>
                    <th scope="col" className="numeric">Observed</th>
                    <th scope="col" className="numeric">Estimated</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Temperature (°C)</th>
                    <td className="numeric tabular">{formatNumber(trueWell.temperatureC, 1)}</td>
                    <td className="numeric tabular">{observationText(obsTemp)}</td>
                    <td className="numeric tabular">{formatNumber(estWell.temperatureC, 1)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Pressure (bar)</th>
                    <td className="numeric tabular">{formatNumber(trueWell.pressureBar, 1)}</td>
                    <td className="numeric tabular">{observationText(obsPress)}</td>
                    <td className="numeric tabular">{formatNumber(estWell.pressureBar, 1)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Rate (kg/s)</th>
                    <td className="numeric tabular">{formatNumber(wellRate, 1)}</td>
                    <td className="numeric tabular">control, not metered</td>
                    <td className="numeric tabular">{formatNumber(wellRate, 1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <span className={`quality-badge quality-badge--${obsTemp?.quality ?? 'missing'}`}>T {obsTemp?.quality ?? 'missing'}</span>{' '}
              <span className={`quality-badge quality-badge--${obsPress?.quality ?? 'missing'}`}>p {obsPress?.quality ?? 'missing'}</span>
              {trueWell.pressureLimited ? (
                <> <span className="quality-badge quality-badge--rejected">deep-drawdown clamp</span></>
              ) : null}
            </p>
            <TimeSeriesChart
              title={`${validWell.id} · ${display.variable === 'temperatureC' ? 'Temperature' : 'Pressure'} history`}
              yLabel={display.variable === 'temperatureC' ? 'Temperature (°C)' : 'Pressure (bar)'}
              currentTime={cycle.timeYears}
              lines={[
                { label: 'Hidden true state', role: 'truth', points: wellSeries('true') },
                { label: 'Observed', role: 'observation', points: wellSeries('obs') },
                { label: 'Estimated state', role: 'estimate', points: wellSeries('est') },
              ]}
              digits={1}
              caption="Local disaggregated histories at absolute values. Gaps are missing surveillance readings, never interpolated."
            />
            <p className="note">
              Wellhead surveillance is illustrative. The twin assimilates bulk
              plant temperature and pressure, not these per-well readings.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2>Well table — year {formatNumber(cycle.timeYears, 1)} ({source})</h2>
            <span className="role-chip role-chip--observation">Surveillance</span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">True and estimated well conditions at the slider time</caption>
              <thead>
                <tr>
                  <th scope="col">Well</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="numeric">Rate (kg/s)</th>
                  <th scope="col" className="numeric">True → estimated T (°C)</th>
                  <th scope="col" className="numeric">True → estimated p (bar)</th>
                  <th scope="col">T surveillance</th>
                  <th scope="col">p surveillance</th>
                </tr>
              </thead>
              <tbody>
                {layout.wells.map((w) => {
                  const trueWc = shownTruth.find((s) => s.wellId === w.id)!;
                  const estWc = shownEst.find((s) => s.wellId === w.id)!;
                  const obsT = shownObs.find((o) => o.wellId === w.id && o.channel === 'temperatureC');
                  const obsP = shownObs.find((o) => o.wellId === w.id && o.channel === 'pressureBar');
                  return (
                    <tr key={w.id} className={w.id === validWell.id ? 'is-selected' : undefined}>
                      <th scope="row">
                        <button
                          type="button"
                          className="well-select"
                          aria-pressed={w.id === validWell.id}
                          onClick={() => setSelectedWell(w.id)}
                        >
                          {w.id}
                        </button>
                      </th>
                      <td>{w.kind}</td>
                      <td className="numeric tabular">{formatNumber(estWc.rateKgS, 1)}</td>
                      <td className="numeric tabular">
                        {formatNumber(trueWc.temperatureC, 1)} → {formatNumber(estWc.temperatureC, 1)}
                      </td>
                      <td className="numeric tabular">
                        {formatNumber(trueWc.pressureBar, 1)} → {formatNumber(estWc.pressureBar, 1)}
                      </td>
                      <td>
                        <span className={`quality-badge quality-badge--${obsT?.quality ?? 'missing'}`}>
                          {observationText(obsT)}
                        </span>
                      </td>
                      <td>
                        <span className={`quality-badge quality-badge--${obsP?.quality ?? 'missing'}`}>
                          {observationText(obsP)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            Bulk {source} state: {formatNumber(bulk.temperatureC, 1)} °C /{' '}
            {formatNumber(bulk.pressureBar, 1)} bar. Estimated wells come from the
            posterior bulk state; true wells come from the hidden trajectory.
          </p>
        </div>

        <details className="method-details">
          <summary>How to read this reduced-order map</summary>
          <p>
            The map does not simulate groundwater flow. It adds steady production
            drawdown, injection support and bounded injector cooling to the tank
            bulk state. Absolute views retain bulk history; deviation views make
            the small simulated spatial signal readable on a fixed scale.
          </p>
          <p className="note">
            Spatial version {spatial.SPATIAL_VERSION} · layout version {layout.layoutVersion} ·{' '}
            {nCycles - 1} yearly snapshots · seed {seed}.
          </p>
        </details>
      </main>
    </div>
  );
}
