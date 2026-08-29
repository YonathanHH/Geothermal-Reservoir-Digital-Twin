'use client';

import { useState } from 'react';
import { Axes, ChartFrame, Legend, PLOT_MARGIN, linearScale, ticks } from './chart-primitives';
import { formatNumber } from '../lib/format';

const WIDTH = 620;
const HEIGHT = 300;
const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

/**
 * Heights on the curve at which each series' direct label is anchored. Distinct per
 * slot so that similarly shaped curves do not stack their labels on the same spot.
 */
const LABEL_ANCHORS = [0.62, 0.38, 0.78, 0.22];

export interface ExceedanceSeries {
  label: string;
  /** Sorted ascending capacity values with their exceedance probability. */
  points: { value: number; exceedance: number }[];
}

/**
 * Exceedance (reverse cumulative) curves - the resource-assessment convention.
 *
 * Read vertically: at any capacity on the x-axis, the curve gives the probability the
 * field achieves at least that much. P90 is the conservative estimate, P10 optimistic.
 */
export function ExceedanceChart({
  series,
  markers = [0.9, 0.5, 0.1],
}: {
  series: ExceedanceSeries[];
  markers?: number[];
}) {
  const [cursor, setCursor] = useState<number | null>(null);

  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  if (allValues.length === 0) {
    return (
      <ChartFrame title="Probability of achieving a given capacity" description="No data to display.">
        <p className="empty-state">No realizations to plot.</p>
      </ChartFrame>
    );
  }

  const domainX: [number, number] = [0, Math.max(...allValues)];
  const domainY: [number, number] = [0, 1];
  const x = linearScale(domainX, [PLOT_MARGIN.left, WIDTH - PLOT_MARGIN.right]);
  const y = linearScale(domainY, [HEIGHT - PLOT_MARGIN.bottom, PLOT_MARGIN.top]);

  const atProbability = (points: ExceedanceSeries['points'], p: number) => {
    // Points run ascending in value, so exceedance runs descending.
    const hit = points.find((point) => point.exceedance <= p);
    return hit?.value ?? points.at(-1)?.value ?? 0;
  };

  const primary = series[0]!;
  const describe = markers
    .map((p) => `P${Math.round(p * 100)} ${formatNumber(atProbability(primary.points, p), 2)} MWe`)
    .join(', ');

  return (
    <ChartFrame
      title="Probability of achieving a given capacity"
      description={`Exceedance curve for ${primary.label}. ${describe}.`}
      caption={
        <>
          Read vertically: the curve gives the probability of achieving at least that
          capacity. <strong>P90</strong> is the conservative case, <strong>P10</strong>{' '}
          the optimistic one.
        </>
      }
      actions={
        series.length > 1 ? (
          <Legend
            items={series.map((s, i) => ({ label: s.label, color: SERIES_COLORS[i % SERIES_COLORS.length]! }))}
          />
        ) : null
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="chart-svg"
        role="img"
        aria-label="Exceedance probability curve for generation capacity"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
          if (px < PLOT_MARGIN.left || px > WIDTH - PLOT_MARGIN.right) setCursor(null);
          else setCursor(px);
        }}
        onMouseLeave={() => setCursor(null)}
      >
        <Axes
          width={WIDTH}
          height={HEIGHT}
          x={x}
          y={y}
          xTicks={ticks(domainX, 6)}
          yTicks={[0, 0.25, 0.5, 0.75, 1]}
          xLabel="Generation capacity (MWe)"
          yLabel="Probability of achieving"
          formatX={(v) => formatNumber(v, 0)}
          formatY={(v) => `${Math.round(v * 100)}%`}
        />

        {/* Reference lines at the percentiles the industry quotes. */}
        {markers.map((p) => (
          <g key={p}>
            <line
              x1={PLOT_MARGIN.left}
              x2={WIDTH - PLOT_MARGIN.right}
              y1={y(p)}
              y2={y(p)}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text x={WIDTH - PLOT_MARGIN.right} y={y(p) - 4} textAnchor="end" fill="var(--text-muted)" fontSize={10}>
              P{Math.round(p * 100)}
            </text>
          </g>
        ))}

        {series.map((s, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length]!;
          const d = s.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.value)},${y(p.exceedance)}`).join(' ');
          // Anchor each label to a different height on its own curve so labels for
          // curves of similar shape cannot land on top of one another.
          const anchorProbability = LABEL_ANCHORS[i % LABEL_ANCHORS.length]!;
          const labelX = x(atProbability(s.points, anchorProbability));
          return (
            <g key={s.label}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              {/* Direct label: identity never rests on colour alone. */}
              {series.length > 1 ? (
                <text
                  x={labelX + 8}
                  y={y(anchorProbability) - 8}
                  fill={color}
                  fontSize={11}
                  fontWeight={600}
                  textAnchor={labelX > WIDTH * 0.6 ? 'end' : 'start'}
                >
                  {s.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {cursor !== null ? (
          <g pointerEvents="none">
            <line
              x1={cursor}
              x2={cursor}
              y1={PLOT_MARGIN.top}
              y2={HEIGHT - PLOT_MARGIN.bottom}
              stroke="var(--text-muted)"
              strokeWidth={1}
            />
            {series.map((s, i) => {
              const value = ((cursor - PLOT_MARGIN.left) / (x(domainX[1]) - x(domainX[0]))) * domainX[1];
              const point = s.points.find((p) => p.value >= value) ?? s.points.at(-1)!;
              return (
                <g key={s.label}>
                  <circle
                    cx={cursor}
                    cy={y(point.exceedance)}
                    r={4}
                    fill={SERIES_COLORS[i % SERIES_COLORS.length]!}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                  <text
                    x={cursor + 8}
                    y={y(point.exceedance) - 8}
                    fill="var(--text-primary)"
                    fontSize={11}
                    fontWeight={600}
                    className="tabular"
                  >
                    {formatNumber(value, 1)} MWe &middot; {Math.round(point.exceedance * 100)}%
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}
      </svg>
    </ChartFrame>
  );
}
