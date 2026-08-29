'use client';

import type { SummaryStatistics } from '@geo/core';
import { formatNumber } from '../lib/format';

/**
 * The headline numbers. A stat tile rather than a chart: these are single values whose
 * job is to be read exactly, not compared visually.
 */
export function PercentileTiles({ statistics }: { statistics: SummaryStatistics }) {
  const at = (p: number) => statistics.exceedance.find((e) => e.probability === p)?.value ?? NaN;

  const tiles = [
    { label: 'P90', value: at(0.9), note: 'Conservative — 90% chance of at least this' },
    { label: 'P50', value: at(0.5), note: 'Median expectation' },
    { label: 'P10', value: at(0.1), note: 'Optimistic — 10% chance of at least this' },
    { label: 'Mean', value: statistics.mean, note: `Std. deviation ${formatNumber(statistics.stdev, 2)} MWe` },
  ];

  return (
    <dl className="tiles">
      {tiles.map((tile) => (
        <div className="tile" key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>
            <span className="tile__value tabular">{formatNumber(tile.value, 2)}</span>
            <span className="tile__unit">MWe</span>
          </dd>
          <p className="tile__note">{tile.note}</p>
        </div>
      ))}
    </dl>
  );
}

/** The full summary block for the capacity distribution. */
export function SummaryTable({ statistics }: { statistics: SummaryStatistics }) {
  const rows: [string, string, string][] = [
    ['Number of samples', statistics.n.toLocaleString('en-US'), 'samples'],
    ['Mean', formatNumber(statistics.mean, 4), 'MWe'],
    ['Standard deviation', formatNumber(statistics.stdev, 4), 'MWe'],
    ['Median', formatNumber(statistics.median, 4), 'MWe'],
    ['Minimum', formatNumber(statistics.min, 4), 'MWe'],
    ['Maximum', formatNumber(statistics.max, 4), 'MWe'],
    ['Skewness', formatNumber(statistics.skew, 4), '—'],
    ['Kurtosis', formatNumber(statistics.kurt, 4), '—'],
    ['Logarithmic mean', formatNumber(statistics.lnMean, 4), 'MWe'],
    ['Logarithmic std. deviation', formatNumber(statistics.lnStdev, 4), 'MWe'],
  ];

  return (
    <table className="data-table">
      <caption className="visually-hidden">Summary statistics for generation capacity</caption>
      <thead>
        <tr>
          <th scope="col">Statistic</th>
          <th scope="col" className="numeric">
            Value
          </th>
          <th scope="col">Unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value, unit]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className="numeric tabular">{value}</td>
            <td className="unit">{unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Exceedance table - the tabular relief for the exceedance chart. */
export function ExceedanceTable({ statistics }: { statistics: SummaryStatistics }) {
  return (
    <table className="data-table">
      <caption className="visually-hidden">Generation capacity by exceedance probability</caption>
      <thead>
        <tr>
          <th scope="col">Probability of achieving</th>
          <th scope="col" className="numeric">
            Capacity
          </th>
        </tr>
      </thead>
      <tbody>
        {statistics.exceedance.map((entry) => (
          <tr key={entry.probability}>
            <th scope="row">P{Math.round(entry.probability * 100)}</th>
            <td className="numeric tabular">{formatNumber(entry.value, 3)} MWe</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
