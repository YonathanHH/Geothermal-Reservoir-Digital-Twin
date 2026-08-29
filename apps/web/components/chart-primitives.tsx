'use client';

/**
 * Shared building blocks for the SVG charts.
 *
 * Charts are hand-drawn SVG rather than a charting library: the whole visual system is
 * driven by CSS custom properties, so light/dark and the theme toggle work without a
 * second palette definition, and every mark can carry its own accessible label.
 */
import type { ReactNode } from 'react';

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

/** Linear scale mapping a data domain onto a pixel range. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  scale.domain = domain;
  scale.range = range;
  return scale;
}

/**
 * Round tick values covering `domain`, aiming for `count` ticks.
 * Uses the 1/2/5/10 progression so labels stay readable.
 */
export function ticks(domain: [number, number], count = 5): number[] {
  const [lo, hi] = domain;
  const span = hi - lo;
  if (span <= 0) return [lo];
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) {
    out.push(Number(t.toFixed(10)));
  }
  return out;
}

export const PLOT_MARGIN = { top: 12, right: 16, bottom: 40, left: 52 };

interface AxesProps {
  width: number;
  height: number;
  x: Scale;
  y: Scale;
  xTicks: number[];
  yTicks: number[];
  xLabel: string;
  yLabel: string;
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
}

/**
 * Gridlines, ticks and axis titles.
 *
 * Grid and axis are recessive by design: hairline gridlines in --grid, labels in
 * --text-muted, so the data marks carry the visual weight.
 */
export function Axes({
  width,
  height,
  x,
  y,
  xTicks,
  yTicks,
  xLabel,
  yLabel,
  formatX = String,
  formatY = String,
}: AxesProps) {
  const plotBottom = height - PLOT_MARGIN.bottom;
  return (
    <g aria-hidden="true">
      {yTicks.map((tick) => (
        <g key={`y${tick}`}>
          <line
            x1={PLOT_MARGIN.left}
            x2={width - PLOT_MARGIN.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--grid)"
            strokeWidth={1}
          />
          <text
            x={PLOT_MARGIN.left - 8}
            y={y(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fill="var(--text-muted)"
            fontSize={11}
            className="tabular"
          >
            {formatY(tick)}
          </text>
        </g>
      ))}

      {xTicks.map((tick) => (
        <text
          key={`x${tick}`}
          x={x(tick)}
          y={plotBottom + 16}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={11}
          className="tabular"
        >
          {formatX(tick)}
        </text>
      ))}

      <line
        x1={PLOT_MARGIN.left}
        x2={width - PLOT_MARGIN.right}
        y1={plotBottom}
        y2={plotBottom}
        stroke="var(--axis)"
        strokeWidth={1}
      />

      <text
        x={PLOT_MARGIN.left + (width - PLOT_MARGIN.left - PLOT_MARGIN.right) / 2}
        y={height - 4}
        textAnchor="middle"
        fill="var(--text-secondary)"
        fontSize={11}
      >
        {xLabel}
      </text>
      <text
        transform={`translate(12 ${PLOT_MARGIN.top + (plotBottom - PLOT_MARGIN.top) / 2}) rotate(-90)`}
        textAnchor="middle"
        fill="var(--text-secondary)"
        fontSize={11}
      >
        {yLabel}
      </text>
    </g>
  );
}

interface ChartFrameProps {
  title: string;
  /** What the reader should take from the chart, and what drives it. */
  caption?: ReactNode;
  /** Sentence describing the chart for screen readers, replacing the visual. */
  description: string;
  children: ReactNode;
  actions?: ReactNode;
}

/** Titled card wrapper shared by every chart, with its accessible description. */
export function ChartFrame({ title, caption, description, children, actions }: ChartFrameProps) {
  return (
    <figure className="chart-frame">
      <div className="chart-frame__head">
        <figcaption>
          <h3>{title}</h3>
        </figcaption>
        {actions}
      </div>
      <p className="visually-hidden">{description}</p>
      {children}
      {caption ? <p className="chart-frame__caption">{caption}</p> : null}
    </figure>
  );
}

/** Legend swatch row. Present whenever two or more series share a plot. */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className="legend__swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
