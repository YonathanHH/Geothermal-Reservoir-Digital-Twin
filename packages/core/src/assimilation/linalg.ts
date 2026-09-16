/**
 * Tiny matrix utilities for the EnKF analysis (Phase 2).
 *
 * The analysis never exceeds STATE_DIM × 2 (three state elements, at most two
 * observations), so hand-rolled helpers beat a dependency. All functions are
 * pure and allocate plain arrays. No partial pivoting theatrics: the only
 * inverse needed is 1×1 or symmetric-positive-definite 2×2, guarded by an
 * explicit determinant check that fails loudly instead of returning garbage.
 */

/** Dot product. */
function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Column means of a row-major m×n matrix. */
export function columnMeans(rows: readonly (readonly number[])[]): number[] {
  const n = rows[0]!.length;
  const means = new Array<number>(n).fill(0);
  for (const row of rows) for (let j = 0; j < n; j++) means[j]! += row[j]!;
  for (let j = 0; j < n; j++) means[j]! /= rows.length;
  return means;
}

/** Row-major anomalies (rows minus column means). */
export function anomalies(rows: readonly (readonly number[])[]): number[][] {
  const means = columnMeans(rows);
  return rows.map((row) => row.map((v, j) => v - means[j]!));
}

/**
 * Sample cross-covariance A·Bᵀ/(n−1) where A is (dA × n), B is (dB × n),
 * both given row-major as n rows of dA / dB elements. Returns dA × dB.
 */
export function crossCovariance(
  aRows: readonly (readonly number[])[],
  bRows: readonly (readonly number[])[],
): number[][] {
  const n = aRows.length;
  const aAnom = anomalies(aRows);
  const bAnom = anomalies(bRows);
  const dA = aRows[0]!.length;
  const dB = bRows[0]!.length;
  const out: number[][] = Array.from({ length: dA }, () => new Array<number>(dB).fill(0));
  for (let i = 0; i < dA; i++) {
    for (let j = 0; j < dB; j++) {
      let s = 0;
      for (const k in aAnom) s += aAnom[k]![i]! * bAnom[k]![j]!;
      out[i]![j] = s / Math.max(n - 1, 1);
    }
  }
  return out;
}

/**
 * Inverse of a 1×1 or symmetric 2×2 matrix. Throws when the determinant is
 * not safely positive — a collapsed ensemble must be reported, not inverted.
 */
export function invertSymmetric(m: number[][]): number[][] {
  if (m.length === 1) {
    const det = m[0]![0]!;
    if (!(det > 0)) throw new RangeError(`enkf: 1x1 innovation covariance ${det} is not positive.`);
    return [[1 / det]];
  }
  if (m.length === 2 && m[0]!.length === 2) {
    const a = m[0]![0]!;
    const b = m[0]![1]!;
    const c = m[1]![1]!;
    const det = a * c - b * b;
    if (!(det > 0)) {
      throw new RangeError(`enkf: 2x2 innovation covariance determinant ${det} is not positive.`);
    }
    return [
      [c / det, -b / det],
      [-b / det, a / det],
    ];
  }
  throw new RangeError(`enkf: invertSymmetric only supports 1x1 and 2x2, got ${m.length}x${m[0]?.length}.`);
}

/** Matrix product A·B for small dense row-major matrices. */
export function matMul(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const inner = b.length;
  const cols = b[0]!.length;
  const out: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const aik = a[i]![k]!;
      for (let j = 0; j < cols; j++) out[i]![j]! += aik * b[k]![j]!;
    }
  }
  return out;
}
