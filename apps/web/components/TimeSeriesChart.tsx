'use client';

import { Axes, ChartFrame, Legend, PLOT_MARGIN, linearScale, ticks } from './chart-primitives';
import { formatNumber } from '../lib/format';

const WIDTH = 620;
const HEIGHT = 300;
const LINE_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const BAND_FILL = 'var(--role-band)';
const ROLE_STYLES: Record<TimeSeriesRole, { color: string; dash?: string; marker: boolean }> = {
  truth: { color: 'var(--role-truth)', marker: false },
  observation: { color: 'var(--role-observation)', dash: '2 4', marker: true },
  estimate: { color: 'var(--role-estimate)', marker: false },
  forecast: { color: 'var(--role-forecast)', dash: '7 4', marker: false },
  reference: { color: 'var(--role-reference)', dash: '4 4', marker: false },
};

function styleFor(
  line: TimeSeriesLine,
  index: number,
): { color: string; dash?: string; marker: boolean; role?: TimeSeriesRole } {
  if (!line.role) return { color: LINE_COLORS[index % LINE_COLORS.length]!, marker: false };
  return { ...ROLE_STYLES[line.role], role: line.role };
}

export type TimeSeriesRole = 'truth' | 'observation' | 'estimate' | 'forecast' | 'reference';

export interface TimeSeriesLine {
  label: string;
  /**
   * Semantic role controls colour and line treatment: blue truth, marked
   * observations, green estimates, dashed orange forecasts, muted references.
   * Lines without a role keep the legacy categorical order.
   */
  role?: TimeSeriesRole;
  /** Points in ascending time order. `null` values are gaps: the path breaks. */
  points: { t: number; value: number | null }[];
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
 * plus, optionally, a single P10–P90 ensemble range with its P50 spine. The
 * band is a shaded area between two curves of the same quantity, not a second
 * series on a second scale. Band math is unchanged: the range runs from the
 * conservative P90 (percentile 0.1) to the optimistic P10 (percentile 0.9).
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
  currentTime,
}: {
  title: string;
  xLabel?: string;
  yLabel: string;
  lines?: TimeSeriesLine[];
  band?: TimeSeriesBand | null;
  digits?: number;
  caption?: React.ReactNode;
  description?: string;
  /** Optional vertical time cursor synchronized with maps and tables. */
  currentTime?: number;
}) {
  const allT = [...lines.flatMap((l) => l.points.map((p) => p.t)), ...(band?.points.map((p) => p.t) ?? [])];
  const allV = [
    ...lines.flatMap((l) => l.points.map((p) => p.value).filter((v): v is number => v !== null)),
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

  // A null value breaks the path so missing observations read as gaps,
  // never as interpolated segments.
  const line = (points: { t: number; value: number | null }[]) => {
    let d = '';
    let penDown = false;
    for (const p of points) {
      if (p.value === null) {
        penDown = false;
        continue;
      }
      d += `${penDown ? 'L' : 'M'}${x(p.t)},${y(p.value)} `;
      penDown = true;
    }
    return d;
  };

  const autoDescription =
    description ??
    `${title} over ${formatNumber(tMax, 0)} years. ` +
      lines.map((l) => `${l.label} ends at ${formatNumber(l.points.at(-1)?.value ?? NaN, digits)}`).join('. ');

  const legendItems = [
    ...lines.map((l, i) => {
      const style = styleFor(l, i);
      return {
        label: l.label,
        color: style.color,
        lineStyle: (style.marker ? 'marker' : style.dash ? 'dashed' : 'solid') as 'marker' | 'dashed' | 'solid',
      };
    }),
    ...(band ? [{ label: `${band.label} P10–P90 ensemble range`, color: BAND_FILL, lineStyle: 'solid' as const }] : []),
  ];
  const showCursor =
    currentTime !== undefined && Number.isFinite(currentTime) && currentTime >= 0 && currentTime <= tMax;

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
        {showCursor ? (
          <line
            x1={x(currentTime!)}
            x2={x(currentTime!)}
            y1={PLOT_MARGIN.top}
            y2={HEIGHT - PLOT_MARGIN.bottom}
            stroke="var(--border-strong)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            aria-hidden="true"
          />
        ) : null}
        {band ? (
          <g aria-hidden="true">
            {(() => {
              const pts = band.points;
              const dx =
                pts.length > 1
                  ? Math.abs(x(pts[1]!.t) - x(pts[0]!.t))
                  : WIDTH;
              // One stick per step, slightly overlapped: immune to polygon
              // winding artefacts when a percentile oscillates step to step.
              const w = Math.min(24, Math.max(1.5, dx * 1.15));
              return pts.map((p, j) => (
                <line
                  key={j}
                  x1={x(p.t)}
                  x2={x(p.t)}
                  y1={y(p.p10)}
                  y2={y(p.p90)}
                  stroke={BAND_FILL}
                  strokeWidth={w}
                  opacity={0.22}
                />
              ));
            })()}
            <title>{`${band.label}: P10–P90 ensemble range across trajectories (P90 conservative to P10 optimistic)`}</title>
          </g>
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
        {lines.map((l, i) => {
          const style = styleFor(l, i);
          return (
            <g key={l.label}>
              <path
                d={line(l.points)}
                fill="none"
                stroke={style.color}
                strokeWidth={style.role === 'reference' ? 2 : 2.5}
                strokeDasharray={style.dash}
                strokeLinejoin="round"
                opacity={style.role === 'reference' ? 0.9 : 1}
              >
                <title>{`${l.label}: ${formatNumber(l.points.at(-1)?.value ?? NaN, digits)} at year ${formatNumber(tMax, 0)}`}</title>
              </path>
              {style.marker
                ? l.points.map((p, j) =>
                    p.value === null ? null : (
                      <circle
                        key={`${l.label}-${j}`}
                        cx={x(p.t)}
                        cy={y(p.value)}
                        r={3}
                        fill="var(--surface)"
                        stroke={style.color}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    ),
                  )
                : null}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
