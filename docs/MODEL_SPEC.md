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

No production or injection well models, ML surrogate, data assimilation, or
natural-language layer. See `ROADMAP.md`.

## 11. Dynamic reduced-order tank model (Phase 1)

`packages/core/src/dynamics/`. A reduced-order synthetic reservoir model, not a
high-fidelity reservoir simulator. The static assessment characterises the
reservoir; the dynamics evolve it. Pure explicit-Euler steps, no randomness in
the step itself; versioned separately as `DYNAMICS_VERSION` (`0.1.0`), since no
static numerical output changed.

Horizon: 30 years at a 1-month timestep (`HORIZON_YEARS`, `STEPS_PER_YEAR`,
`TOTAL_STEPS = 360` in `dynamics/schedule.ts`). Controls are prescribed rates
only — `productionKgS`, `injectionKgS`, `injectionTemperatureC` (default 80, 56
and 60 °C) — with an explicit per-step schedule when time variation is needed.
There is no pressure-target controller yet.

### 11.1 Dynamic-only uncertain parameters

Sampled alongside the static table from their own RNG streams
(`seed:cTotal`, `seed:recharge`), so static columns stay bit-identical:

| Parameter | Symbol | Unit | Min | Most likely | Max | Distribution |
|---|---|---|---:|---:|---:|---|
| Total compressibility | cTotal | 1/bar | 0.002 | 0.008 | 0.03 | PERT |
| Natural recharge rate | recharge | kg/s | 0.5 | 2 | 5 | PERT |

`cTotal` is an effective pressure-storage parameter, not a measured property;
`recharge` is a small constant inflow whose default most-likely value is forty
times smaller than default production, so the baseline stays
production/injection driven.

### 11.2 Initialisation

`dynamics/init.ts`, `initialDynamicState(inputs, { totalCompressibilityPerBar, rechargeKgS })`:

```
V   = A · 10⁶ · H                                        [m³]
Vp  = V · φ                                             [m³]
p0  = max(ρ0 · 9.81 · D / 10⁵, 1.001 · psat(T0))        [bar]
M0  = Vp · ρ(p0, T0)                                    [kg]
E0  = V · CT(p0, T0) · (T0 − Ta) / 10¹²                 [PJ]
CT(p, T) = ρ(p, T) · cp(p, T) · φ + (1 − φ) · CR        [kJ/m³/°C]
```

`T0` is the static reservoir temperature; `p0` is the hydrostatic column at
reservoir liquid density, raised to the `1.001 × psat` liquid margin where the
column does not clear saturation (hot and shallow). `E0` is the static eq.-2
form re-anchored at `p0`, which is what makes an idle tank exactly idle; it
agrees with static `QR` to well under a percent.

### 11.3 One step

`dynamics/step.ts`, `step(state, controls, params, dtSeconds)` with frozen
properties at the incoming state:

```
Mass:   M_{t+1} = M_t + (q_inj − q_prod + q_re) · dt
Energy: E_{t+1} = E_t + (q_inj·h_inj + q_re·h_re − q_prod·h_prod) · dt / 10¹²   [PJ]
  h_prod = hRes(T_t) − D · 9.81 / 1000        [kJ/kg, wellhead basis as in §2.4]
  h_inj  = hInj(T_inj)                        [kJ/kg, default hL at 60 °C, no p dependence]
  h_re   = hRes(T_t)                          [kJ/kg, recharge arrives at reservoir T]
T_{t+1} = Ta + E_{t+1} · 10¹² / (V · CT_t)    [°C, explicit inversion of §2.2]
p_{t+1} = p_t + (M_{t+1} − M_t) / (ρ_t · Vp · cTotal)   [bar]
```

`hRes`/`hInj` are injectable `EnthalpyProvider(temperatureC, pressureBar?)`
functions defaulting to `hL(T)`, so a pressure-dependent `hPT(p, T)` can be
supplied later without redesigning the API. Injection pressure is ignored in V1.

### 11.4 Instantaneous capacity diagnostic

The static exergy (§2.7–2.9) evaluated at the new state and the current rate:

```
w     = (hWH − ho − (Ta + 273.15) · (sWH − so))   [kJ/kg]
P_inst = q_prod · w · u / (1000 · F)              [MWe, nameplate-equivalent]
```

This is the power the current rate sustains at the current state — a different
concept from the static lifetime-average capacity, and not comparable to it.

### 11.5 Ensemble

`dynamics/ensemble.ts`, `runDynamicEnsemble({ n, seed, parameters,
dynamicParameters, schedule })`. Returns every trajectory (`TOTAL_STEPS + 1`
states), final capacity/temperature/pressure series, and `rejected[]` entries
with the last completed step and reason. Tanks that deplete their mass or
pressure storage throw inside `step` and are recorded rather than producing
`NaN` — e.g. a small tank cannot sustain 80 kg/s for 30 years, and the model
refuses rather than misleads.

## 12. Synthetic field telemetry (Phase 1.5)

`packages/core/src/telemetry/`. A pure observation layer over recorded dynamic
trajectories: hidden TRUE state → sensor model → noise, bias and sampling →
observation. No reservoir equations, no feedback into the dynamics, versioned
separately as `TELEMETRY_VERSION` (`0.1.0`). All values are synthetic.

### 12.1 Channels and field layout

Five channels in stable order, grouped on a synthetic field with one production
well (PW-01) and one plant:

| Channel | Source | Unit | Default σ | Default dropout |
|---|---|---|---:|---:|
| temperatureC | PW-01 | °C | 1.5 | 0.01 |
| pressureBar | PW-01 | bar | 0.8 | 0.01 |
| productionKgS | PW-01 | kg/s | 1.0 | 0.005 |
| injectionKgS | plant | kg/s | 1.0 | 0.005 |
| generationMWe | plant | MWe | 0.15 | 0.005 |

Bias defaults to 0 everywhere. A lumped tank cannot honestly feed distinct
wells, so per-well variation is not modelled.

### 12.2 Truth mapping

```
T_obs ← tank temperatureC            (reservoir conditions observed directly)
p_obs ← tank pressureBar             (no wellbore hydraulics resolved)
q_prod ← controls in effect at that time   (meters observe the setpoint + noise)
q_inj  ← controls in effect at that time
P_obs ← state capacityMweInstant     (plant meter)
```

### 12.3 Observation model

Per channel per sampled step, from that channel's isolated sensor stream
(`mulberry32(seedFromString(`${seed}:obs:${channel}:${trajectoryIndex}`))`):

```
u ~ Uniform; if u < dropoutRate → { quality: 'missing', reason: 'dropout' }
z = true + bias + σ · BoxMuller(rng)     (exactly two uniform draws)
if z outside plausibility bounds → { quality: 'rejected', reason: 'out-of-range' }
else → { quality: 'ok', observed: z, residual: z − true }
```

Plausibility bounds: T in (0, 350) °C (IF97 liquid domain), pressure > 0,
rates and generation ≥ 0 — a reading of exactly 0 (idle rate) is legitimate.
Zero-noise configuration (σ = bias = dropout = 0) reproduces truth exactly.

### 12.4 Cadence and records

V1 cadence is monthly (`cadenceSteps: 1`): states at indices 0, 1, 2, … are
observed. Every `TelemetryPoint` carries continuous `timeYears` plus the step
index, channel, source, unit, true and observed values, residual, quality and
reason — the flat handoff record a Phase-2 estimator will consume via
`observeTrajectory` / `observeEnsemble` / `summarizeTelemetry` (per-channel
RMSE and mean residual over usable points).

## 13. Ensemble state estimation (Phase 2)

`packages/core/src/assimilation/`. A stochastic Ensemble Kalman Filter over
the dynamic tank, versioned as `ASSIMILATION_VERSION` (`0.1.0`). A
reduced-order synthetic prototype, not a production assimilation system.

### 13.1 State, forecast, observation

Estimated state vector `x = [T, p, M]` (temperature, pressure, fluid mass).
Forecast is the existing `step()`; rates are known controls and generation a
diagnostic, so neither is estimated. Stored energy and capacity are rebuilt
from each posterior (T, p) with the same eq.-2/exergy formulas the step uses
(`thermalEnergyFromTP`, `instantaneousCapacity`), keeping posterior states
internally consistent by construction.

Assimilated channels are wellhead temperature and pressure only: both observe
the state almost directly, so the observation operator H is linear identity
rows and R is diagonal from the telemetry sensor sigmas. Missing readings
contribute no row — a fully-missing cycle passes the forecast through
untouched. Generation readings are displayed but not assimilated.

### 13.2 Analysis (perturbed observations)

```
Dⱼ = y + εⱼ,  εⱼ ∼ N(0, R)     (fresh `seed:enkf:{cycle}` stream per cycle)
K  = P_xy · (P_yy + R)⁻¹         (sample covariances; 1×1 or 2×2 inverse)
xⱼᵃ = xⱼᶠ + K · (Dⱼ − H xⱼᶠ)
```

Posteriors failing physical validation (finite, liquid-domain T, positive p
and M) keep their forecast member and are counted as `totalFallbacks` —
tracked separately from `analysisSkipped` cycles where the innovation
covariance itself was singular and no update was attempted. Zero-noise
(σ = 0) observations are valid: perturbed observations then equal the reading
and the gain trusts them fully. Optional
multiplicative inflation (default 1 = off) is supported but not needed for the
validation experiment.

### 13.3 Twin experiment

`runTwinExperiment({ n, seed, …, assimilationIntervalSteps = 12,
initialTemperatureBiasC = 15 })`: one most-likely truth runs the horizon while
its noisy telemetry is recorded once; an N-member ensemble sampling full
parameter uncertainty on bit-identical streams starts +15 °C hot (energy
rebuilt consistently) and is corrected yearly; a parallel free run of the same
members is the control. Members exhausting their tank drop out per run and
cycle metrics use members active in both. Headline metric: final-cycle
posterior/free error ratio (≈0.02–0.04 for T, ≈0.05–0.13 for p at n = 30–50).

### 13.4 Innovation diagnostics (Phase 2.5)

Every cycle with usable readings records the innovation (observation minus
prior mean) and its expected std, `sqrt(sample variance + R)`, per channel —
the numbers that audit whether the forecast uncertainty means what it claims.
Innovations mostly inside ±2σ indicate honest spread; persistent excursions
would mean overconfidence. The result also carries all three layer versions
(model, dynamics, assimilation) as provenance.
