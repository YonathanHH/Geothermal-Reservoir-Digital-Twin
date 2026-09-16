'use client';

import { Axes, ChartFrame, Legend, PLOT_MARGIN, linearScale, ticks } from './chart-primitives';
import { formatNumber } from '../lib/format';

const WIDTH = 620;
const HEIGHT = 300;
const LINE_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const BAND_FILL = 'var(--series-1)';

export interface TimeSeriesLine {
  label: string;
  /** Points in ascending time order. */
  points: { t: number; value: number }[];
}

export interface TimeSeriesBand {
  label: string;
  /** P90 (low), P50 and P10 (high) at each time, ascending in t. */
  points: { t: number; p90: number; p50: number; p10: number }[];
}

/**
 * Time-series chart for dynamic trajectories.
 *
 * One frame per quantity (no dual axes): each chart shows deterministic lines
 * plus, optionally, a single P90–P10 uncertainty band with its P50 spine. The
 * band is a shaded area between two curves of the same quantity, not a second
 * series on a second scale.
 */
export function TimeSeriesChart({
  title,
  xLabel = 'Time (years)',
  yLabel,
  lines = [],
  band = null,
  digits = 2,
  caption,
  description,
}: {
  title: string;
  xLabel?: string;
  yLabel: string;
  lines?: TimeSeriesLine[];
  band?: TimeSeriesBand | null;
  digits?: number;
  caption?: React.ReactNode;
  description?: string;
}) {
  const allT = [...lines.flatMap((l) => l.points.map((p) => p.t)), ...(band?.points.map((p) => p.t) ?? [])];
  const allV = [
    ...lines.flatMap((l) => l.points.map((p) => p.value)),
    ...(band?.points.flatMap((p) => [p.p90, p.p50, p.p10]) ?? []),
  ];
  if (allT.length === 0 || allV.length === 0) {
    return (
      <ChartFrame title={title} description="No data to display.">
        <p className="empty-state">No trajectory to plot.</p>
      </ChartFrame>
    );
  }

  const tMax = Math.max(...allT);
  const vMin = Math.min(...allV);
  const vMax = Math.max(...allV);
  const pad = (vMax - vMin || Math.abs(vMax) || 1) * 0.06;
  const domainX: [number, number] = [0, tMax];
  const domainY: [number, number] = [vMin - pad, vMax + pad];
  const x = linearScale(domainX, [PLOT_MARGIN.left, WIDTH - PLOT_MARGIN.right]);
  const y = linearScale(domainY, [HEIGHT - PLOT_MARGIN.bottom, PLOT_MARGIN.top]);

  const line = (points: { t: number; value: number }[]) =>
    points.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.t)},${y(p.value)}`).join(' ');

  const autoDescription =
    description ??
    `${title} over ${formatNumber(tMax, 0)} years. ` +
      lines.map((l) => `${l.label} ends at ${formatNumber(l.points.at(-1)?.value ?? NaN, digits)}`).join('. ');

  const legendItems = [
    ...lines.map((l, i) => ({ label: l.label, color: LINE_COLORS[i % LINE_COLORS.length]! })),
    ...(band ? [{ label: `${band.label} P90–P10`, color: BAND_FILL }] : []),
  ];

  return (
    <ChartFrame
      title={title}
      caption={caption}
      description={autoDescription}
      actions={legendItems.length > 1 ? <Legend items={legendItems} /> : null}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="chart-svg" role="img" aria-label={title}>
        <Axes
          width={WIDTH}
          height={HEIGHT}
          x={x}
          y={y}
          xTicks={ticks(domainX, 6)}
          yTicks={ticks(domainY, 5)}
          xLabel={xLabel}
          yLabel={yLabel}
          formatX={(v) => formatNumber(v, 0)}
          formatY={(v) => formatNumber(v, digits)}
        />
        {band ? (
          <path
            d={
              `${band.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.t)},${y(p.p10)}`).join(' ')} ` +
              `${[...band.points].reverse().map((p) => `L${x(p.t)},${y(p.p90)}`).join(' ')} Z`
            }
            fill={BAND_FILL}
            opacity={0.18}
          >
            <title>{`${band.label}: P90–P10 uncertainty band across ensemble trajectories`}</title>
          </path>
        ) : null}
        {band ? (
          <path
            d={line(band.points.map((p) => ({ t: p.t, value: p.p50 })))}
            fill="none"
            stroke={BAND_FILL}
            strokeWidth={2}
            strokeDasharray="6 3"
            strokeLinejoin="round"
          >
            <title>{`${band.label} median (P50)`}</title>
          </path>
        ) : null}
        {lines.map((l, i) => (
          <path
            key={l.label}
            d={line(l.points)}
            fill="none"
            stroke={LINE_COLORS[i % LINE_COLORS.length]!}
            strokeWidth={2}
            strokeLinejoin="round"
          >
            <title>{`${l.label}: ${formatNumber(l.points.at(-1)?.value ?? NaN, digits)} at year ${formatNumber(tMax, 0)}`}</title>
          </path>
        ))}
      </svg>
    </ChartFrame>
  );
}
