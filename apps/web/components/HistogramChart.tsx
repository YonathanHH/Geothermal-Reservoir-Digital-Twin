'use client';

import { useId, useState } from 'react';
import type { Histogram } from '@geo/core';
import { Axes, ChartFrame, PLOT_MARGIN, linearScale, ticks } from './chart-primitives';
import { formatNumber } from '../lib/format';

const WIDTH = 620;
const HEIGHT = 300;

/**
 * Frequency histogram of generation capacity.
 *
 * The cumulative curve deliberately gets its own frame rather than a secondary y-axis
 * here: two scales on one plot invite the reader to compare series that are not
 * comparable.
 */
export function HistogramChart({ histogram, total }: { histogram: Histogram; total: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const clipId = useId();

  if (histogram.bins.length === 0) {
    return (
      <ChartFrame title="Distribution of generation capacity" description="No data to display.">
        <p className="empty-state">No realizations to plot.</p>
      </ChartFrame>
    );
  }

  const maxCount = Math.max(...histogram.bins.map((b) => b.count));
  const domainX: [number, number] = [histogram.bins[0]!.lower, histogram.bins.at(-1)!.upper];
  const domainY: [number, number] = [0, maxCount];

  const x = linearScale(domainX, [PLOT_MARGIN.left, WIDTH - PLOT_MARGIN.right]);
  const y = linearScale(domainY, [HEIGHT - PLOT_MARGIN.bottom, PLOT_MARGIN.top]);
  const baseline = y(0);

  // A 2px gap between adjacent fills keeps the bars legible as separate marks.
  const barWidth = Math.max(1, (x(domainX[1]) - x(domainX[0])) / histogram.bins.length - 2);
  const peak = histogram.bins.reduce((a, b) => (b.count > a.count ? b : a));

  return (
    <ChartFrame
      title="Distribution of generation capacity"
      description={`Histogram of ${total} Monte Carlo realizations across ${histogram.bins.length} bins. The most populated bin is ${peak.label} megawatts electric, containing ${peak.count} realizations.`}
      caption={
        <>
          Most likely range <strong>{histogram.mostLikelyRange} MWe</strong>, containing{' '}
          {peak.count} of {total} realizations. The right tail is longer than the left
          because capacity is a product of several uncertain factors.
        </>
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label="Histogram of generation capacity"
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x={PLOT_MARGIN.left}
              y={PLOT_MARGIN.top}
              width={WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right}
              height={HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom}
            />
          </clipPath>
        </defs>

        <Axes
          width={WIDTH}
          height={HEIGHT}
          x={x}
          y={y}
          xTicks={ticks(domainX, 6)}
          yTicks={ticks(domainY, 5)}
          xLabel="Generation capacity (MWe)"
          yLabel="Realizations"
          formatX={(v) => formatNumber(v, 1)}
        />

        <g clipPath={`url(#${clipId})`}>
          {histogram.bins.map((bin, i) => {
            const height = baseline - y(bin.count);
            const isHovered = hovered === i;
            return (
              <rect
                key={bin.label}
                x={x(bin.lower) + 1}
                y={y(bin.count)}
                width={barWidth}
                height={Math.max(0, height)}
                rx={height > 4 ? 4 : 0}
                fill="var(--series-1)"
                opacity={hovered === null || isHovered ? 1 : 0.45}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${bin.label} MWe: ${bin.count} realizations (${formatNumber(
                  (bin.count / total) * 100,
                  1,
                )}%)`}</title>
              </rect>
            );
          })}
        </g>

        {hovered !== null ? (
          <text
            x={x(histogram.bins[hovered]!.lower) + barWidth / 2 + 1}
            y={y(histogram.bins[hovered]!.count) - 6}
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize={11}
            fontWeight={600}
            className="tabular"
          >
            {histogram.bins[hovered]!.count}
          </text>
        ) : null}
      </svg>
    </ChartFrame>
  );
}
