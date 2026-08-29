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
import { ExceedanceChart } from './ExceedanceChart';
import { HistogramChart } from './HistogramChart';
import { ParameterTable } from './ParameterTable';
import { RunControls, ThemeToggle } from './RunControls';
import { ScenarioLab } from './ScenarioLab';
import { ExceedanceTable, PercentileTiles, SummaryTable } from './StatTiles';
import { TornadoChart } from './TornadoChart';

const TABS = ['Overview', 'Monte Carlo', 'Inputs & sensitivity', 'Scenario lab'] as const;
type Tab = (typeof TABS)[number];

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

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Geothermal Resource Assessment</h1>
          <p className="app__subtitle">
            Probabilistic volumetric resource assessment for {FIELD_NAME}. Every figure below is
            computed in the browser from a three-point estimate of each input. Model version{' '}
            {MODEL_VERSION}.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <RunControls
        n={settings.n}
        seed={settings.seed}
        lifetimeYears={settings.lifetimeYears}
        busy={busy}
        onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        onReset={reset}
      />

      <nav className="tabs" aria-label="Dashboard sections">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`tab${tab === name ? ' is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>

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
          <h2>Model inputs</h2>
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
                <h2>Deterministic most-likely case</h2>
                <p className="panel__intro">
                  The full calculation chain evaluated at every input&rsquo;s most-likely value.
                  Intermediates are shown so the physics can be checked, not just the answer &mdash;
                  and note this is <em>not</em> the median of the Monte Carlo run, because the chain
                  is nonlinear in temperature.
                </p>
                <CalculationLadder result={model.deterministic} />
              </div>
              <div className="panel">
                <h2>Summary statistics</h2>
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
                <h2>Capacity by exceedance probability</h2>
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
                <h2>Model inputs</h2>
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
  );
}
