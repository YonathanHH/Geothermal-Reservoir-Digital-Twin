/** Number formatting shared across the dashboard. */

/** Fixed-decimal formatting with thousands separators; em dash for non-finite values. */
export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '\u2014';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Compact formatting that keeps small and large magnitudes both readable. */
export function formatAuto(value: number): string {
  if (!Number.isFinite(value)) return '\u2014';
  const magnitude = Math.abs(value);
  if (magnitude === 0) return '0';
  if (magnitude < 0.01 || magnitude >= 1e6) return value.toExponential(3);
  const digits = magnitude < 1 ? 4 : magnitude < 100 ? 3 : 1;
  return formatNumber(value, digits);
}

/** Signed percentage, for scenario deltas. */
export function formatDelta(relative: number): string {
  if (!Number.isFinite(relative)) return '\u2014';
  const pct = relative * 100;
  return `${pct >= 0 ? '+' : ''}${formatNumber(pct, 1)}%`;
}

/** A fraction rendered as a percentage, for the inputs stored as fractions. */
export function formatFraction(value: number, digits = 1): string {
  return `${formatNumber(value * 100, digits)}%`;
}
