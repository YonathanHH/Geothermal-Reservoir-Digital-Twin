# Model Specification

The model as implemented. Limitations are in `ASSUMPTIONS.md`; what is checked and how is
in `VERIFICATION.md`.

## 1. Inputs

Implemented in `packages/core/src/model.ts` as `DEFAULT_PARAMETERS`. These values
describe a **synthetic demonstration field** — plausible round numbers, not a real asset.

| Parameter | Symbol | Unit | Min | Most likely | Max | Distribution |
|---|---|---|---:|---:|---:|---|
| Reservoir Area | A | km² | 2 | 4 | 6 | PERT |
| Reservoir Thickness | H | m | 300 | 600 | 900 | PERT |
| Reservoir Temperature | T | °C | 160 | 220 | 280 | PERT |
| Recovery Factor | R | fraction | 0.05 | 0.12 | 0.20 | PERT |
| Utilization Factor | u | fraction | 0.30 | 0.40 | 0.50 | PERT |
| Porosity | φ | fraction | 0.04 | 0.10 | 0.16 | Uniform |
| Specific Heat of Rock | CR | kJ/m³/°C | — | 2500 | — | Fixed |
| Average Reservoir Depth | D | m | — | 500 | — | Fixed |
| Ambient Temperature | Ta | °C | — | 20 | — | Fixed |
| Plant Capacity Factor | F | fraction | — | 0.90 | — | Fixed |
| Project Lifetime | L | years | — | 30 | — | not sampled |

Six inputs carry uncertainty. `Fixed` inputs use only their most-likely value, so their
min and max are held equal to it rather than left as decorative numbers that never affect
a result.

### Distributions

| Label | Meaning |
|---|---|
| `PERT` | Beta-PERT from the three-point estimate. Mean `(min + 4·ml + max)/6`; symmetric case is Beta(3,3). Sampled by inverse CDF. |
| `Triangular` | Triangular, by inverse CDF. |
| `Uniform` | Uniform on [min, max). |
| `Fixed` | Constant at the most-likely value. |

## 2. Calculation chain

`packages/core/src/physics.ts`, `calculateResource`. Pure: same inputs, same outputs, no
randomness, no I/O.

Mass is carried in **Pg (10¹² kg)** so available work falls out directly in PJ, avoiding a
×10¹² / ÷10¹² round trip through the enthalpy balance.

### 2.1 Combined volumetric heat capacity

```
CT = ρ(p, T) · cp(p, T) · φ + (1 − φ) · CR        [kJ/m³/°C]
where p = 1.001 · psat(T)
```

The rock and the pore water are treated as one thermal mass at a shared temperature. The
1.001 factor keeps the property evaluation just inside the compressed-liquid region
rather than exactly on the saturation line.

### 2.2 Reservoir thermal energy

```
QR = A · H · CT · (T − Ta) / 10⁶                  [PJ]
```

The heat stored relative to the ambient sink. km² × m × kJ/(m³·°C) × °C = 10⁶ kJ, hence
the divisor.

### 2.3 Recovered thermal energy

```
QWH = QR · R                                      [PJ]
```

`R` carries the entire question of how much of the heat in the ground can actually be
produced. See `ASSUMPTIONS.md` §1.

### 2.4 Wellhead and ambient enthalpy

```
hWH = hL(T) − D · 9.81 / 1000                     [kJ/kg]
ho  = hL(Ta)                                      [kJ/kg]
```

Saturated liquid at reservoir temperature, less the hydrostatic head lost climbing the
well.

### 2.5 Wellhead and ambient entropy

```
sWH = s(psat(T), hWH)                             [kJ/kg/K]
so  = sL(Ta)                                      [kJ/kg/K]
```

### 2.6 Mass of fluid produced

```
mWH = QWH / (hWH − ho)                            [Pg = 10¹² kg]
```

The mass that must be produced to carry `QWH` across the wellhead-to-ambient enthalpy
drop.

### 2.7 Available work

```
WA = mWH · (hWH − ho − (Ta + 273.15) · (sWH − so))  [PJ]
```

The exergy: the thermodynamically available fraction of the recovered heat, after the
Carnot penalty for rejecting to an ambient sink at `Ta`. This is a maximum, not an
achievable output.

### 2.8 Electrical energy

```
E = WA · u                                        [PJ]
```

`u` stands in for the whole power plant — turbine efficiency, parasitic load, cycle
choice.

### 2.9 Generation capacity

```
P = E · 10⁹ / (F · L · 365.25 · 24 · 60 · 60)     [MWe]
```

The average capacity sustaining that energy over the project life. `10⁹` converts PJ to
MJ; the denominator is plant-operating seconds, using a 365.25-day year.

## 3. Outputs

`calculateResource` returns every intermediate: `ctKjM3C`, `qrPj`, `qwhPj`, `hwhKjKg`,
`hoKjKg`, `swhKjKgK`, `soKjKgK`, `mwhPg`, `waPj`, `ePj`, `capacityMwe`.

This is a requirement, not a convenience: it lets an implausible result be traced to the
step that produced it rather than merely doubted.

## 4. Monte Carlo engine

`packages/core/src/monteCarlo.ts`. Default N = 1000; any N ≥ 2.

Sampling is column-major, and **each parameter draws from its own generator**, seeded
from the run seed combined with the parameter name. That isolation is what lets a
scenario comparison attribute a difference to the change rather than to a reshuffled
random stream.

Every run records `runId`, `seed`, `n`, `modelVersion`, `timestamp`, the resolved
parameter set, and per realization both its sampled inputs and its full output chain.
Realizations whose inputs fall outside the domain of validity are collected in `rejected`
with a reason rather than producing `NaN`.

## 5. Statistics

`packages/core/src/stats.ts`. Sample forms throughout: standard deviation with the n−1
denominator, skewness and kurtosis with their sample-size corrections, percentiles by
linear interpolation between order statistics.

The headline table is **exceedance**, not plain percentiles: `value(p) = percentile(1−p)`
for p ∈ {1, .95, .9, .75, .5, .25, .1, .05, 0}. P90 is the conservative estimate — a 90%
chance of achieving at least that capacity — and P10 the optimistic one.

`histogram.ts` builds 20 equal bins from min to max, upper-inclusive, with cumulative and
reverse-cumulative columns and a trailing `more` bucket.

## 6. Sensitivity

`packages/core/src/sensitivity.ts`. Pearson correlation and OLS slope of capacity against
each sampled input; `Fixed` inputs reported as zero. Slopes for fraction-valued inputs are
divided by 100, so the unit is MWe per percentage point. Normalised correlation divides by
the sum of all correlations, so the column reads as a contribution share.

Spearman rank correlation is computed alongside and reported separately. The linearity
caveat is in `ASSUMPTIONS.md` §7.

## 7. Thermodynamics

`packages/core/src/steam/`. IAPWS-IF97 Region 1 and Region 4 plus the backward equation
`T(p,h)`, implemented from the published standard. `if97.ts` works in MPa and K;
`index.ts` is the bar/°C facade.

Domain: 0 °C < T < 350 °C, liquid side only. Regions 2, 3 and 5 are absent; calls outside
the domain throw `RangeError`.

## 8. Input validation

`packages/core/src/validate.ts` throws `ModelInputError`, naming the field, for:
non-positive area or thickness; temperature outside the IF97 liquid domain; ambient
temperature at or above reservoir temperature; recovery, utilization or capacity factor
outside (0, 1]; porosity outside [0, 1); non-positive rock heat capacity; negative depth;
non-positive lifetime; any non-finite value.

## 9. Scenarios

`packages/core/src/scenarios.ts`. A scenario is a **diff** against the baseline — a set of
parameter overrides plus optional lifetime, seed and n — so a change to the baseline
propagates and the intent of the scenario stays legible. The resolved snapshot is recorded
on the run, which is what makes an archived result reproducible.

## 10. Not implemented

No time dimension, state evolution, production or injection controls, well models, ML
surrogate, data assimilation, or natural-language layer. See `ROADMAP.md`.
