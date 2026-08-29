/**
 * Model verification report.
 *
 * Run with `pnpm verify`. This is a human-readable companion to the unit tests: it
 * prints the numbers a reviewer would want to see rather than merely asserting them,
 * and exits non-zero if any check fails.
 *
 * Three kinds of claim, kept apart because they are held to very different standards:
 *
 *  1. **External** - the thermodynamic properties, checked against the published
 *     IAPWS-IF97 verification points. These are exact claims against a public standard.
 *
 *  2. **Internal consistency** - relationships the model must satisfy if it is correct,
 *     independent of any reference. Capacity is exactly linear in four of its inputs,
 *     so for those `slope x mean(input)` must equal `mean(capacity)`. This catches a
 *     large class of errors in the physics, the sampler and the statistics at once,
 *     with no external data required.
 *
 *  3. **Reproducibility** - the same seed must always yield the same run.
 *
 * What this cannot establish is that the underlying volumetric method is a good model
 * of a geothermal reservoir. See docs/ASSUMPTIONS.md.
 */
import {
  DEFAULT_PARAMETERS,
  MODEL_VERSION,
  calculateResource,
  histogram,
  inputSeries,
  mostLikelyInputs,
  pertShape,
  runMonteCarlo,
  sensitivity,
  steam,
  summarize,
} from '../core/src/index.js';

const N = 1000;
const SEED = 42;

let failures = 0;

const fmt = (x: number, digits = 6) =>
  Number.isFinite(x) ? x.toFixed(digits).padStart(14) : String(x).padStart(14);

function heading(title: string): void {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

function check(name: string, actual: number, expected: number, tolerance: number, kind: 'relative' | 'absolute' = 'relative'): void {
  const absolute = Math.abs(actual - expected);
  const error = kind === 'relative' ? absolute / Math.abs(expected) : absolute;
  const ok = error <= tolerance;
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} model ${fmt(actual)}   expected ${fmt(expected)}` +
      `   ${kind === 'relative' ? 'rel' : 'abs'} err ${error.toExponential(2).padStart(10)}   tol ${tolerance.toExponential(1)}`,
  );
}

function assert(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${detail}`);
}

// ---------------------------------------------------------------------------

heading('1. Thermodynamics vs the published IAPWS-IF97 verification points');

// Release on the IAPWS Industrial Formulation 1997, Table 5 (Region 1).
check('IF97 v(3 MPa, 300 K)', steam.v1_pT(3, 300), 0.100215168e-2, 1e-8);
check('IF97 h(3 MPa, 300 K)', steam.h1_pT(3, 300), 0.115331273e3, 1e-8);
check('IF97 s(3 MPa, 300 K)', steam.s1_pT(3, 300), 0.392294792, 1e-8);
check('IF97 cp(3 MPa, 300 K)', steam.cp1_pT(3, 300), 0.417301218e1, 1e-8);
check('IF97 v(80 MPa, 300 K)', steam.v1_pT(80, 300), 0.971180894e-3, 1e-8);
check('IF97 h(3 MPa, 500 K)', steam.h1_pT(3, 500), 0.975542239e3, 1e-8);
// Table 7 (Region 1 backward equation).
check('IF97 T(3 MPa, 500 kJ/kg)', steam.t1_ph(3, 500), 0.391798509e3, 1e-8);
check('IF97 T(80 MPa, 1500 kJ/kg)', steam.t1_ph(80, 1500), 0.611041229e3, 1e-8);
// Tables 35 and 36 (Region 4, the saturation line).
check('IF97 psat(500 K)', steam.p4_T(500), 0.263889776e1, 1e-8);
check('IF97 Tsat(1 MPa)', steam.t4_p(1), 0.453035632e3, 1e-8);

// ---------------------------------------------------------------------------

heading('2. Deterministic most-likely case');

const deterministic = calculateResource(mostLikelyInputs());
const chain: [string, number, string][] = [
  ['CT  combined heat capacity', deterministic.ctKjM3C, 'kJ/m3/degC'],
  ['QR  thermal energy in place', deterministic.qrPj, 'PJ'],
  ['QWH recovered energy', deterministic.qwhPj, 'PJ'],
  ['hWH wellhead enthalpy', deterministic.hwhKjKg, 'kJ/kg'],
  ['ho  ambient enthalpy', deterministic.hoKjKg, 'kJ/kg'],
  ['sWH wellhead entropy', deterministic.swhKjKgK, 'kJ/kg/K'],
  ['so  ambient entropy', deterministic.soKjKgK, 'kJ/kg/K'],
  ['mWH produced mass', deterministic.mwhPg, 'Pg'],
  ['WA  available work', deterministic.waPj, 'PJ'],
  ['E   electrical energy', deterministic.ePj, 'PJ'],
  ['P   generation capacity', deterministic.capacityMwe, 'MWe'],
];
for (const [label, value, unit] of chain) {
  console.log(`      ${label.padEnd(30)} ${fmt(value)}  ${unit}`);
}

console.log('');
// The second law: available work cannot exceed the heat it was extracted from.
assert(
  'WA < QWH (second law)',
  deterministic.waPj > 0 && deterministic.waPj < deterministic.qwhPj,
  `${deterministic.waPj.toFixed(3)} PJ of ${deterministic.qwhPj.toFixed(3)} PJ ` +
    `(exergetic efficiency ${((deterministic.waPj / deterministic.qwhPj) * 100).toFixed(1)}%)`,
);
assert('E < WA (utilization < 1)', deterministic.ePj < deterministic.waPj);

// ---------------------------------------------------------------------------

heading('3. Internal consistency of the Monte Carlo engine');

const run = runMonteCarlo({ n: N, seed: SEED });
const stats = summarize(run.capacityMwe);

assert('no realizations rejected', run.rejected.length === 0, `${run.rejected.length} rejected`);
assert('all realizations retained', run.capacityMwe.length === N, `${run.capacityMwe.length} of ${N}`);

const repeat = runMonteCarlo({ n: N, seed: SEED });
assert(
  'same seed reproduces the run',
  repeat.capacityMwe.every((v, i) => v === run.capacityMwe[i]),
);
const different = runMonteCarlo({ n: N, seed: SEED + 1 });
assert(
  'different seed changes the run',
  different.capacityMwe.some((v, i) => v !== run.capacityMwe[i]),
);

for (const key of ['A', 'H', 'T', 'R', 'u', 'fi'] as const) {
  const spec = DEFAULT_PARAMETERS[key];
  const xs = inputSeries(run, key);
  assert(
    `${key} stays within bounds`,
    xs.every((v) => v >= spec.min && v <= spec.max),
    `[${Math.min(...xs).toFixed(4)}, ${Math.max(...xs).toFixed(4)}] within [${spec.min}, ${spec.max}]`,
  );
}
for (const key of ['CR', 'D', 'Ta', 'F'] as const) {
  const unique = new Set(inputSeries(run, key));
  assert(`${key} is held fixed`, unique.size === 1 && [...unique][0] === DEFAULT_PARAMETERS[key].mostLikely);
}

console.log('');
console.log('      Exact-linearity identity: for an input the capacity is strictly proportional');
console.log('      to, the regression slope must equal mean(P) / mean(input). A large sample');
console.log('      makes this a sharp test of the physics, the sampler and the statistics at once.');
console.log('');

const bigRun = runMonteCarlo({ n: 200000, seed: 7 });
const bigStats = summarize(bigRun.capacityMwe);
for (const entry of sensitivity(bigRun).filter((e) => e.varies)) {
  const spec = bigRun.parameters[entry.key];
  // Capacity is exactly linear in these four; not in temperature or porosity.
  if (!['A', 'H', 'R', 'u'].includes(entry.key)) continue;
  const xs = inputSeries(bigRun, entry.key);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const rawSlope = entry.slope * (spec.fractional ? 100 : 1);
  check(`linearity: ${entry.key}`, rawSlope * meanX, bigStats.mean, 0.03);
}

// ---------------------------------------------------------------------------

heading('4. Sampler properties');

// A Beta-PERT sample must converge on the PERT mean, (min + 4*ml + max) / 6.
for (const key of ['A', 'H', 'T', 'R'] as const) {
  const spec = DEFAULT_PARAMETERS[key];
  const { mean: pertMean } = pertShape(spec.mostLikely, spec.min, spec.max);
  const xs = inputSeries(bigRun, key);
  const sampled = xs.reduce((a, b) => a + b, 0) / xs.length;
  check(`PERT mean: ${key}`, sampled, pertMean, 0.01);
}

// The symmetric case must reduce to alpha = beta = 3, and must survive the
// floating-point noise that makes an exact-equality test unreliable.
const symmetric = pertShape(0.4, 0.35, 0.45);
assert(
  'symmetric PERT gives alpha = beta = 3',
  Math.abs(symmetric.alpha - 3) < 1e-12 && Math.abs(symmetric.beta - 3) < 1e-12,
  `alpha=${symmetric.alpha}, beta=${symmetric.beta}`,
);

// A PERT draw must be more concentrated than a uniform one over the same range -
// this is the whole point of using the most-likely value.
const uniformSd = (DEFAULT_PARAMETERS.A.max - DEFAULT_PARAMETERS.A.min) / Math.sqrt(12);
const areaSeries = inputSeries(bigRun, 'A');
const areaMean = areaSeries.reduce((a, b) => a + b, 0) / areaSeries.length;
const areaSd = Math.sqrt(areaSeries.reduce((a, b) => a + (b - areaMean) ** 2, 0) / (areaSeries.length - 1));
assert(
  'PERT is tighter than uniform',
  areaSd < uniformSd,
  `sd ${areaSd.toFixed(4)} vs uniform ${uniformSd.toFixed(4)} over the same range`,
);

// ---------------------------------------------------------------------------

heading('5. Statistics and histogram');

const hist = histogram(run.capacityMwe);
assert('20 bins', hist.bins.length === 20);
assert(
  'every value binned exactly once',
  hist.bins.reduce((sum, b) => sum + b.count, 0) + hist.more === N,
);
assert(
  'cumulative reaches 1',
  Math.abs(hist.bins[19]!.cumulative - 1) < 1e-12,
);
assert(
  'exceedance is monotonic',
  stats.exceedance.every((e, i, all) => i === 0 || e.value >= all[i - 1]!.value),
);

const at = (p: number) => stats.exceedance.find((e) => e.probability === p)!.value;
assert('P90 < P50 < P10', at(0.9) < stats.median && stats.median < at(0.1));

console.log('');
console.log(`      n = ${N}, seed = ${SEED}`);
console.log(`      P90 ${at(0.9).toFixed(3)} MWe   P50 ${at(0.5).toFixed(3)} MWe   P10 ${at(0.1).toFixed(3)} MWe`);
console.log(`      mean ${stats.mean.toFixed(3)} MWe   sd ${stats.stdev.toFixed(3)} MWe   skew ${stats.skew.toFixed(3)}`);
console.log(`      most likely range ${hist.mostLikelyRange} MWe`);

console.log('');
console.log('      driver                        correlation     norm.     slope');
for (const entry of sensitivity(run).filter((e) => e.varies).sort((a, b) => b.correlation - a.correlation)) {
  console.log(
    `      ${entry.label.padEnd(28)} ${fmt(entry.correlation, 4)}${fmt(entry.normalizedCorrelation, 4)}` +
      `  ${entry.slope.toFixed(4)} ${entry.slopeUnit}`,
  );
}

// ---------------------------------------------------------------------------

heading('Result');
console.log(`model version ${MODEL_VERSION}`);
if (failures === 0) {
  console.log('All checks passed.');
} else {
  console.log(`${failures} check(s) FAILED.`);
  process.exitCode = 1;
}
