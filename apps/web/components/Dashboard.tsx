'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  DEFAULT_LIFETIME_YEARS,
  FIELD_NAME,
  MODEL_VERSION,
  ModelInputError,
  calculateResource,
  cloneParameters,
  empiricalCdf,
  histogram,
  mostLikelyInputs,
  runMonteCarlo,
  sensitivity,
  summarize,
  type DistributionLabel,
  type ParameterKey,
  type ParameterSpec,
} from '@geo/core';

import { CalculationLadder } from './CalculationLadder';
import { DynamicModelView } from './DynamicModelView';
import { ExceedanceChart } from './ExceedanceChart';
import { FieldMapView } from './FieldMapView';
import { HistogramChart } from './HistogramChart';
import { OperationsView } from './OperationsView';
import { ParameterTable } from './ParameterTable';
import { RunControls, ThemeToggle } from './RunControls';
import { ScenarioLab } from './ScenarioLab';
import { ExceedanceTable, PercentileTiles, SummaryTable } from './StatTiles';
import { TelemetryView } from './TelemetryView';
import { TornadoChart } from './TornadoChart';
import { TwinView } from './TwinView';

const TABS = ['Overview', 'Monte Carlo', 'Inputs & sensitivity', 'Scenario lab', 'Dynamic model', 'Field telemetry', 'Digital twin', 'Field map', 'Operations'] as const;
type Tab = (typeof TABS)[number];

const NAV_GROUPS: { title: string; tabs: Tab[] }[] = [
  { title: 'Assess', tabs: ['Overview', 'Monte Carlo', 'Inputs & sensitivity', 'Scenario lab'] },
  { title: 'Operate', tabs: ['Dynamic model', 'Field telemetry', 'Digital twin', 'Operations'] },
  { title: 'Field', tabs: ['Field map'] },
];

/** Minimal stroke glyphs for the rail nav. One per view, currentColor, 16px grid. */
function NavIcon({ tab }: { tab: Tab }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
  switch (tab) {
    case 'Overview':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      );
    case 'Monte Carlo':
      return (
        <svg {...common}>
          <path d="M2 13.5h12" />
          <path d="M4 13V8.5" />
          <path d="M8 13V4.5" />
          <path d="M12 13V10" />
        </svg>
      );
    case 'Inputs & sensitivity':
      return (
        <svg {...common}>
          <path d="M2 5.5h12" />
          <path d="M2 10.5h12" />
          <circle cx="6.5" cy="5.5" r="1.8" fill="var(--surface-sunken)" />
          <circle cx="10" cy="10.5" r="1.8" fill="var(--surface-sunken)" />
        </svg>
      );
    case 'Scenario lab':
      return (
        <svg {...common}>
          <circle cx="3.5" cy="8" r="1.5" />
          <path d="M5 8h3.5c2 0 1.5-4 3.5-4H14" />
          <path d="M5 8h3.5c2 0 1.5 4 3.5 4H14" />
        </svg>
      );
    case 'Dynamic model':
      return (
        <svg {...common}>
          <path d="M1.5 8h2.5l1.8-4.5 2.4 9 1.8-4.5h4.5" />
        </svg>
      );
    case 'Field telemetry':
      return (
        <svg {...common}>
          <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <path d="M5 9.5a4.2 4.2 0 0 1 6 0" />
          <path d="M3 7.2a7 7 0 0 1 10 0" />
        </svg>
      );
    case 'Digital twin':
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="8" height="8" rx="1.5" />
          <rect x="6.5" y="6.5" width="8" height="8" rx="1.5" />
        </svg>
      );
    case 'Field map':
      return (
        <svg {...common}>
          <ellipse cx="8" cy="8" rx="6" ry="4.6" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'Operations':
      return (
        <svg {...common}>
          <path d="M2 12.5 6 8.5l2.5 2.5L14 4.5" />
          <path d="M10.5 4.5H14V8" />
        </svg>
      );
  }
}

const VIEW_META: Record<Tab, { eyebrow: string; title: string; lede: string }> = {
  Overview: {
    eyebrow: 'Assess · Resource',
    title: 'Resource overview',
    lede: `Probabilistic volumetric assessment for ${FIELD_NAME}. Every figure is computed in the browser from a three-point estimate of each input.`,
  },
  'Monte Carlo': {
    eyebrow: 'Assess · Uncertainty',
    title: 'Monte Carlo distribution',
    lede: 'The full capacity distribution: how likely each outcome is, and how much is conservatively bankable.',
  },
  'Inputs & sensitivity': {
    eyebrow: 'Assess · Drivers',
    title: 'Inputs & sensitivity',
    lede: 'Edit any value to re-run the assessment. The ranking below shows which inputs actually move the answer.',
  },
  'Scenario lab': {
    eyebrow: 'Assess · Compare',
    title: 'Scenario lab',
    lede: 'Side-by-side futures on a shared seed, so differences are the effect of the change — not resampling noise.',
  },
  'Dynamic model': {
    eyebrow: 'Operate · Reservoir',
    title: 'Dynamic reservoir model',
    lede: 'Thirty years of monthly tank behaviour under your operating rates, with ensemble geology.',
  },
  'Field telemetry': {
    eyebrow: 'Operate · Measurements',
    title: 'Field telemetry',
    lede: 'What synthetic sensors report about the hidden reservoir — noise, bias, gaps and all.',
  },
  'Digital twin': {
    eyebrow: 'Operate · Twin',
    title: 'Reservoir control room',
    lede: 'Biased estimates corrected with noisy wellhead observations; the latest estimate starts a ten-year forecast.',
  },
  'Field map': {
    eyebrow: 'Field · Spatial',
    title: 'Field map',
    lede: 'Bulk twin state disaggregated onto production, injection and observation wells.',
  },
  Operations: {
    eyebrow: 'Operate · Decisions',
    title: 'Operations & forecast',
    lede: 'Scenario branches from today\u2019s estimated state, with outlooks and threshold alerts.',
  },
};

export function Dashboard() {
  const [parameters, setParameters] = useState<Record<ParameterKey, ParameterSpec>>(() => cloneParameters());
  const [settings, setSettings] = useState({
    n: 1000,
    seed: 42,
    lifetimeYears: DEFAULT_LIFETIME_YEARS,
  });
  const [tab, setTab] = useState<Tab>('Overview');

  // Sampling thousands of realizations on every keystroke would block the input; the
  // deferred copy lets typing stay responsive and the charts catch up.
  const deferred = useDeferredValue({ parameters, settings });
  const busy = deferred.parameters !== parameters || deferred.settings !== settings;

  const model = useMemo(() => {
    try {
      const run = runMonteCarlo({
        n: deferred.settings.n,
        seed: deferred.settings.seed,
        parameters: deferred.parameters,
        lifetimeYears: deferred.settings.lifetimeYears,
      });
      return {
        run,
        statistics: summarize(run.capacityMwe),
        histogram: histogram(run.capacityMwe),
        sensitivity: sensitivity(run),
        deterministic: calculateResource(
          mostLikelyInputs(deferred.parameters, deferred.settings.lifetimeYears),
        ),
        error: null as string | null,
      };
    } catch (error) {
      const message =
        error instanceof ModelInputError || error instanceof RangeError
          ? error.message
          : 'The model could not be evaluated with these inputs.';
      return { run: null, statistics: null, histogram: null, sensitivity: null, deterministic: null, error: message };
    }
  }, [deferred]);

  const updateParameter = (key: ParameterKey, field: 'min' | 'mostLikely' | 'max', value: number) =>
    setParameters((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));

  const updateDistribution = (key: ParameterKey, distribution: DistributionLabel) =>
    setParameters((current) => ({ ...current, [key]: { ...current[key], distribution } }));

  const reset = () => {
    setParameters(cloneParameters());
    setSettings({ n: 1000, seed: 42, lifetimeYears: DEFAULT_LIFETIME_YEARS });
  };

  const meta = VIEW_META[tab];

  return (
    <div className="app">
      <aside className="rail" aria-label="Primary">
        <div className="rail__brand">
          <span className="rail__mark" aria-hidden="true" />
          <div>
            <div className="rail__name">Geothermal Twin</div>
            <div className="rail__field">{FIELD_NAME}</div>
          </div>
        </div>

        <nav className="rail__nav" aria-label="Workspace sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="rail__group">
              <div className="rail__group-title">{group.title}</div>
              <div className="rail__group-list">
                {group.tabs.map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-current={tab === name ? 'page' : undefined}
                    className={`rail__link${tab === name ? ' is-active' : ''}`}
                    onClick={() => setTab(name)}
                  >
                    <span className="rail__icon" aria-hidden="true">
                      <NavIcon tab={name} />
                    </span>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <dl className="rail__status">
          <div>
            <dt>Model</dt>
            <dd className="rail__meta">v{MODEL_VERSION.split('.')[0]}</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd className="rail__meta tabular">{settings.seed}</dd>
          </div>
          <div>
            <dt>Realizations</dt>
            <dd className="rail__meta tabular">{settings.n.toLocaleString('en-US')}</dd>
          </div>
        </dl>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p className="topbar__lede">{meta.lede}</p>
          </div>
          <div className="topbar__side">
            <span className={`run-pill${busy ? ' is-busy' : ''}`} role="status" aria-live="polite">
              {busy ? 'Recomputing' : `seed ${settings.seed} · ${settings.n.toLocaleString('en-US')} runs`}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <RunControls
          n={settings.n}
          seed={settings.seed}
          lifetimeYears={settings.lifetimeYears}
          busy={busy}
          onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          onReset={reset}
        />

        {model.error ? (
          <div className="alert" role="alert">
            <strong>These inputs fall outside the model&rsquo;s domain of validity.</strong>
            <p>{model.error}</p>
            <p>
              The model rejects impossible inputs rather than returning a number that looks
              plausible. Correct the value in <strong>Inputs &amp; sensitivity</strong>, or reset
              to the defaults.
            </p>
            {tab !== 'Inputs & sensitivity' ? (
              <p>
                <button type="button" className="button" onClick={() => setTab('Inputs & sensitivity')}>
                  Go to inputs
                </button>
              </p>
            ) : null}
          </div>
        ) : null}

        {/*
          The input table stays mounted even when the model cannot be evaluated - otherwise
          a single bad keystroke removes the only control that could fix it.
        */}
        {model.error && tab === 'Inputs & sensitivity' ? (
          <div className="panel">
            <div className="panel__head">
              <h2>Model inputs</h2>
            </div>
            <ParameterTable
              parameters={parameters}
              onChange={updateParameter}
              onDistributionChange={updateDistribution}
            />
          </div>
        ) : null}

        {model.error ? null : (
          <main className={busy ? 'is-stale' : undefined}>
            {tab === 'Overview' && model.statistics && model.deterministic ? (
              <div className="stack">
                <PercentileTiles statistics={model.statistics} />
                <div className="panel">
                  <div className="panel__head">
                    <h2>Deterministic most-likely case</h2>
                    <span className="role-chip role-chip--reference">State · most-likely</span>
                  </div>
                  <p className="panel__intro">
                    The full calculation chain evaluated at every input&rsquo;s most-likely value.
                    Intermediates are shown so the physics can be checked, not just the answer &mdash;
                    and note this is <em>not</em> the median of the Monte Carlo run, because the chain
                    is nonlinear in temperature.
                  </p>
                  <CalculationLadder result={model.deterministic} />
                </div>
                <div className="panel">
                  <div className="panel__head">
                    <h2>Summary statistics</h2>
                    <span className="role-chip role-chip--estimate">Estimation · P-tiles</span>
                  </div>
                  <SummaryTable statistics={model.statistics} />
                </div>
              </div>
            ) : null}

            {tab === 'Monte Carlo' && model.statistics && model.histogram && model.run ? (
              <div className="stack">
                <PercentileTiles statistics={model.statistics} />
                <div className="grid-2">
                  <HistogramChart histogram={model.histogram} total={model.run.capacityMwe.length} />
                  <ExceedanceChart
                    series={[
                      {
                        label: 'Base case',
                        points: empiricalCdf(model.run.capacityMwe).map((p) => ({
                          value: p.value,
                          exceedance: p.exceedance,
                        })),
                      },
                    ]}
                  />
                </div>
                <div className="panel">
                  <div className="panel__head">
                    <h2>Capacity by exceedance probability</h2>
                  </div>
                  <ExceedanceTable statistics={model.statistics} />
                </div>
                <p className="note">
                  Run <span className="symbol">{model.run.runId}</span> &middot;{' '}
                  {model.run.capacityMwe.length.toLocaleString('en-US')} realizations
                  {model.run.rejected.length > 0
                    ? `, ${model.run.rejected.length} rejected as physically invalid`
                    : ', none rejected'}
                  .
                </p>
              </div>
            ) : null}

            {tab === 'Inputs & sensitivity' && model.sensitivity ? (
              <div className="stack">
                <div className="panel">
                  <div className="panel__head">
                    <h2>Model inputs</h2>
                    <span className="role-chip role-chip--truth">State · inputs</span>
                  </div>
                  <p className="panel__intro">
                    Edit any value to re-run the assessment. Inputs marked{' '}
                    <span className="symbol">Fixed</span> contribute no uncertainty, so their minimum
                    and maximum are disabled rather than left editable and inert.
                  </p>
                  <ParameterTable
                    parameters={parameters}
                    onChange={updateParameter}
                    onDistributionChange={updateDistribution}
                  />
                </div>
                <TornadoChart entries={model.sensitivity} />
              </div>
            ) : null}

            {tab === 'Scenario lab' ? (
              <ScenarioLab n={settings.n} seed={settings.seed} />
            ) : null}

            {tab === 'Dynamic model' ? (
              <DynamicModelView parameters={deferred.parameters} seed={settings.seed} />
            ) : null}

            {tab === 'Field telemetry' ? (
              <TelemetryView parameters={deferred.parameters} seed={settings.seed} />
            ) : null}

            {tab === 'Digital twin' ? (
              <TwinView parameters={deferred.parameters} seed={settings.seed} />
            ) : null}

            {tab === 'Field map' ? (
              <FieldMapView parameters={deferred.parameters} seed={settings.seed} />
            ) : null}

            {tab === 'Operations' ? (
              <OperationsView parameters={deferred.parameters} seed={settings.seed} />
            ) : null}
          </main>
        )}

        <footer className="app__footer">
          <p>
            Thermodynamic properties use IAPWS-IF97 Region 1 and Region 4, implemented from the
            published standard and pinned to its verification points. Inputs are sampled with a
            Beta-PERT inverse CDF. These are illustrative values for a synthetic field, not an
            assessment of any real asset &mdash; see <code>docs/ASSUMPTIONS.md</code> for the model&rsquo;s
            limits and <code>docs/VERIFICATION.md</code> for what is checked.
          </p>
        </footer>
      </div>
    </div>
  );
}
