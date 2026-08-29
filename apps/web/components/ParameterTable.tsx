'use client';

import { PARAMETER_KEYS, type DistributionLabel, type ParameterKey, type ParameterSpec } from '@geo/core';

const DISTRIBUTIONS: DistributionLabel[] = ['PERT', 'Triangular', 'Uniform', 'Fixed'];

interface ParameterTableProps {
  parameters: Record<ParameterKey, ParameterSpec>;
  onChange: (key: ParameterKey, field: 'min' | 'mostLikely' | 'max', value: number) => void;
  onDistributionChange: (key: ParameterKey, distribution: DistributionLabel) => void;
}

/**
 * The editable input table.
 *
 * Fixed parameters grey out their minimum and maximum because the sampler genuinely
 * ignores them. Leaving those cells editable would invite someone to widen a range and
 * wonder why the result never moves.
 */
export function ParameterTable({ parameters, onChange, onDistributionChange }: ParameterTableProps) {
  return (
    <table className="data-table data-table--inputs">
      <caption className="visually-hidden">Model input parameters and their distributions</caption>
      <thead>
        <tr>
          <th scope="col">Parameter</th>
          <th scope="col">Unit</th>
          <th scope="col" className="numeric">
            Minimum
          </th>
          <th scope="col" className="numeric">
            Most likely
          </th>
          <th scope="col" className="numeric">
            Maximum
          </th>
          <th scope="col">Distribution</th>
        </tr>
      </thead>
      <tbody>
        {PARAMETER_KEYS.map((key) => {
          const spec = parameters[key];
          const fixed = spec.distribution === 'Fixed';
          return (
            <tr key={key}>
              <th scope="row">
                {spec.label} <span className="symbol">({key})</span>
              </th>
              <td className="unit">{spec.unit}</td>
              {(['min', 'mostLikely', 'max'] as const).map((field) => {
                const inert = fixed && field !== 'mostLikely';
                return (
                  <td key={field} className="numeric">
                    <input
                      type="number"
                      className="cell-input tabular"
                      value={spec[field]}
                      step={spec.fractional ? 0.01 : spec.max > 100 ? 10 : 0.1}
                      disabled={inert}
                      aria-label={`${spec.label} ${field}`}
                      title={inert ? 'Fixed inputs use only their most-likely value' : undefined}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) onChange(key, field, next);
                      }}
                    />
                  </td>
                );
              })}
              <td>
                <select
                  className="cell-input"
                  value={spec.distribution}
                  aria-label={`${spec.label} distribution`}
                  onChange={(event) => onDistributionChange(key, event.target.value as DistributionLabel)}
                >
                  {DISTRIBUTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
