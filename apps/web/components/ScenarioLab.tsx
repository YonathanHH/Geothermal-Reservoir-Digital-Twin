'use client';

import { useMemo, useState } from 'react';
import { EXAMPLE_SCENARIOS, compareScenarios, empiricalCdf, runScenario, type Scenario } from '@geo/core';
import { ExceedanceChart, type ExceedanceSeries } from './ExceedanceChart';
import { formatDelta, formatNumber } from '../lib/format';

const MAX_SELECTED = 4;

/**
 * Scenario comparison.
 *
 * Every scenario runs against the same seed, so differences between the curves are the
 * effect of the change and not of resampling. That is the whole reason the comparison
 * is worth making.
 */
export function ScenarioLab({ n, seed }: { n: number; seed: number }) {
  const [selectedIds, setSelectedIds] = useState<string[]>(['base', 'conservative-recovery']);

  const results = useMemo(() => {
    const chosen = EXAMPLE_SCENARIOS.filter((s) => selectedIds.includes(s.id));
    return chosen.map((scenario) => runScenario(scenario, { n, seed }));
  }, [selectedIds, n, seed]);

  const series: ExceedanceSeries[] = results.map((result) => ({
    label: result.scenario.label,
    points: empiricalCdf(result.run.capacityMwe).map((p) => ({ value: p.value, exceedance: p.exceedance })),
  }));

  const toggle = (scenario: Scenario) => {
    setSelectedIds((current) =>
      current.includes(scenario.id)
        ? current.filter((id) => id !== scenario.id)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, scenario.id],
    );
  };

  const comparison = results.length >= 2 ? compareScenarios(results[0]!, results[1]!) : null;

  return (
    <div className="stack">
      <fieldset className="scenario-picker">
        <legend>Scenarios to compare</legend>
        <p className="scenario-picker__help">
          Choose up to {MAX_SELECTED}. All run on seed {seed}, so differences are the effect of the
          change rather than of resampling.
        </p>
        <div className="scenario-picker__grid">
          {EXAMPLE_SCENARIOS.map((scenario) => {
            const checked = selectedIds.includes(scenario.id);
            const atLimit = !checked && selectedIds.length >= MAX_SELECTED;
            return (
              <label key={scenario.id} className={`scenario-option${checked ? ' is-selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={atLimit}
                  onChange={() => toggle(scenario)}
                />
                <span>
                  <strong>{scenario.label}</strong>
                  <span className="scenario-option__note">{scenario.notes}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {results.length === 0 ? (
        <p className="empty-state">Select at least one scenario to see its capacity distribution.</p>
      ) : (
        <ExceedanceChart series={series} />
      )}

      {comparison ? (
        <div className="panel">
          <h3>
            {results[1]!.scenario.label} compared with {results[0]!.scenario.label}
          </h3>
          <table className="data-table">
            <caption className="visually-hidden">Scenario comparison metrics</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="numeric">
                  {results[0]!.scenario.label}
                </th>
                <th scope="col" className="numeric">
                  {results[1]!.scenario.label}
                </th>
                <th scope="col" className="numeric">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.metric}>
                  <th scope="row">
                    {row.metric} <span className="unit">({row.unit})</span>
                  </th>
                  <td className="numeric tabular">{formatNumber(row.baseline, 3)}</td>
                  <td className="numeric tabular">{formatNumber(row.candidate, 3)}</td>
                  <td className="numeric tabular">
                    {/* Direction is carried by the sign, not by colour alone. */}
                    {formatDelta(row.relative)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : results.length > 2 ? (
        <p className="note">
          The comparison table shows the first two selected scenarios; the chart shows all of them.
        </p>
      ) : null}
    </div>
  );
}
