'use client';

import type { SensitivityEntry } from '@geo/core';
import { ChartFrame } from './chart-primitives';
import { formatNumber } from '../lib/format';

/**
 * Tornado chart of input influence on generation capacity.
 *
 * One measure, one hue: this ranks magnitude, so colouring each bar differently would
 * imply an identity encoding that is not there. Values are labelled directly, which is
 * also the relief required by the light-mode contrast warning on the palette.
 */
export function TornadoChart({ entries }: { entries: SensitivityEntry[] }) {
  const varying = entries.filter((e) => e.varies).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  if (varying.length === 0) {
    return (
      <ChartFrame
        title="What drives the result"
        description="No stochastic inputs, so there is no sensitivity to report."
      >
        <p className="empty-state">
          Every input is fixed, so the model is deterministic and nothing drives the spread.
        </p>
      </ChartFrame>
    );
  }

  const maxCorrelation = Math.max(...varying.map((e) => Math.abs(e.correlation)));
  const fixedCount = entries.length - varying.length;

  return (
    <ChartFrame
      title="What drives the result"
      description={`Sensitivity ranking. ${varying
        .map((e) => `${e.label} correlation ${formatNumber(e.correlation, 2)}`)
        .join('; ')}.`}
      caption={
        <>
          Pearson correlation between each sampled input and generation capacity.
          {' '}{fixedCount} further input
          {fixedCount === 1 ? ' is' : 's are'} held fixed and so cannot contribute.
        </>
      }
    >
      <ul className="tornado">
        {varying.map((entry) => (
          <li key={entry.key}>
            <span className="tornado__label">{entry.label}</span>
            <span className="tornado__track">
              <span
                className="tornado__bar"
                style={{ width: `${(Math.abs(entry.correlation) / maxCorrelation) * 100}%` }}
              />
            </span>
            <span className="tornado__value tabular">{formatNumber(entry.correlation, 3)}</span>
            <span className="tornado__slope tabular">
              {formatNumber(entry.slope, 3)} {entry.slopeUnit}
            </span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  );
}
