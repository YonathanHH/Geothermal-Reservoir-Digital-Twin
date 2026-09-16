# Verification

Run with `pnpm verify` (source: `packages/bench/verify.ts`); `pnpm test` runs the same
claims as assertions plus the edge cases. Figures below are from model version 0.2.0.

The word here is **verification**, not validation: these checks establish that the model
computes what it says it computes. Whether the volumetric method is a good model of a
geothermal reservoir is a separate question, and `ASSUMPTIONS.md` is the honest answer to
it.

Three kinds of claim, kept apart because they are held to very different standards.

---

## 1. Thermodynamics — exact, against a public standard

Every IF97 function is pinned to the verification points published with the standard
itself (Release on the IAPWS Industrial Formulation 1997, Tables 5, 7, 35 and 36).

| Verification point | Relative error | Tolerance |
|---|---:|---:|
| `v(3 MPa, 300 K)` | 3.1e−10 | 1e−8 |
| `h(3 MPa, 300 K)` | 1.9e−10 | 1e−8 |
| `s(3 MPa, 300 K)` | 1.0e−9 | 1e−8 |
| `cp(3 MPa, 300 K)` | 9.8e−10 | 1e−8 |
| `v(80 MPa, 300 K)` | 2.2e−11 | 1e−8 |
| `h(3 MPa, 500 K)` | 1.0e−10 | 1e−8 |
| `T(3 MPa, 500 kJ/kg)` — backward | 6.1e−10 | 1e−8 |
| `T(80 MPa, 1500 kJ/kg)` — backward | 6.6e−10 | 1e−8 |
| `psat(500 K)` | 1.4e−9 | 1e−8 |
| `Tsat(1 MPa)` | 8.6e−10 | 1e−8 |

The residual ~1e−9 is the published values' own precision: IAPWS quotes them to nine
significant figures. The unit tests additionally check that the saturation line
round-trips (`Tsat(psat(T)) = T`) and that the bar/°C facade agrees with textbook
saturated-liquid values.

**Why this standard.** The thermodynamics is the one layer with a public, exact
reference. Anything less than agreement to the published precision would mean the
implementation is wrong, so there is no reason to accept less.

## 2. The deterministic chain

Evaluated at every input's most-likely value:

| Step | Value | Unit |
|---|---:|---|
| CT combined heat capacity | 2637.40 | kJ/m³/°C |
| QR thermal energy in place | 1265.95 | PJ |
| QWH recovered energy | 151.91 | PJ |
| hWH wellhead enthalpy | 938.74 | kJ/kg |
| ho ambient enthalpy | 83.92 | kJ/kg |
| sWH wellhead entropy | 2.5078 | kJ/kg/K |
| so ambient entropy | 0.2965 | kJ/kg/K |
| mWH produced mass | 0.1777 | Pg |
| WA available work | 36.71 | PJ |
| E electrical energy | 14.68 | PJ |
| **P generation capacity** | **17.23** | **MWe** |

Checked as relationships rather than magnitudes, since there is no external reference for
this chain:

- **Second law**: available work must be positive and strictly less than the heat it came
  from. 36.71 PJ of 151.91 PJ — an exergetic efficiency of 24.2%, which is a plausible
  figure for a 220 °C resource rejecting to 20 °C.
- **E < WA**, since utilization is below 1.
- **Exact linearity**: doubling area, thickness, recovery or utilization exactly doubles
  capacity (asserted to 9 decimal places). Doubling project life exactly halves it.
- **Monotonicity**: recovered energy increases with reservoir temperature; available work
  decreases as the ambient sink warms; combined heat capacity rises with porosity and
  stays between the rock and water end members.

Note this is **not** the median of the Monte Carlo run (16.16 MWe). The chain is
nonlinear in temperature, so the most-likely input case is not the most-likely output.

## 3. Internal consistency of the Monte Carlo engine

**The load-bearing check.** Capacity is exactly proportional to area, thickness, recovery
and utilization. So for each of those, the regression slope must equal
`mean(capacity) / mean(input)` — equivalently, `slope × mean(input)` must recover
`mean(capacity)`. This exercises the physics, the sampler, the regression and the
summary statistics simultaneously, and needs no external data.

At n = 200,000, against a mean capacity of 17.594 MWe:

| Input | `slope × mean(input)` | Relative error | Tolerance |
|---|---:|---:|---:|
| Reservoir area | 17.526 | 3.9e−3 | 3e−2 |
| Reservoir thickness | 17.592 | 1.2e−4 | 3e−2 |
| Recovery factor | 17.587 | 3.9e−4 | 3e−2 |
| Utilization factor | 17.338 | 1.5e−2 | 3e−2 |

The residuals are sampling error in the slope estimator, which scales as
`CV(rest) / (CV(input) · √n)`. Utilization has the narrowest relative range of the four,
so its slope is the noisiest — as the table shows.

Also checked: no realizations rejected; the requested count returned; every sampled input
inside its declared bounds; every `Fixed` input constant at its most-likely value.

## 4. Reproducibility

- The same seed reproduces a run exactly, element for element.
- A different seed changes it.
- **Fixing one parameter does not disturb the others.** Each parameter draws from its own
  stream, keyed by the run seed and the parameter name. With a single shared stream this
  test fails — making a parameter `Fixed` consumes no draws and shifts everything after
  it, so a scenario comparison would mix the effect of the change with the effect of a
  reshuffled stream. This was a real defect, caught by this test.

## 5. Sampler properties

| Check | Result |
|---|---|
| Sampled mean converges on the PERT mean `(min+4ml+max)/6` | Within 0.1% at n = 200,000, for all four PERT inputs |
| Symmetric case gives α = β = 3 | Exact |
| Symmetry survives floating-point error | α, β > 0 for every default parameter |
| PERT is tighter than uniform over the same range | sd 0.754 vs 1.155 |
| Asymmetric estimates skew the shape | α < β when the mode is low, α > β when high |
| Draws stay within bounds | 5,000 draws, no escapes |
| Invalid three-point estimates throw | Unordered, out-of-range, and degenerate cases |

The "tighter than uniform" check is the one that catches the forward-CDF sampling
mistake described in `ASSUMPTIONS.md` §2: that bug would pass every bounds check while
silently reproducing a uniform distribution.

## 6. Statistics and histogram

20 bins spanning the sample; every value binned exactly once; cumulative reaching 1;
cumulative and reverse-cumulative summing to 1 in every bin; the exceedance table
monotonic; P90 < P50 < P10; skewness positive and mean above median, as expected for a
product of bounded positive factors.

One bug found here: computing bin edges by repeated addition let accumulated
floating-point drift place the final edge a few ulps below the sample maximum, tipping
that value into the `more` bucket. Edges are now computed from the origin and the last is
pinned to the maximum.

## Reproducing

```bash
pnpm install
pnpm test      # 170 unit tests (74 static + 25 dynamics + 21 telemetry + 27 assimilation + 23 spatial)
pnpm verify    # the report above (static engine only)
pnpm run dev   # dashboard at localhost:3000
```

## Dynamics (Phase 1, `packages/core/test/dynamics.test.ts`)

The tank has no external reference standard, so it is held to internal
consistency, following the same spirit as §3 above:

- **Mass balance**: `M_end − M0` equals net rate × time to 4 decimals over 360
  steps; cumulative meters match their rates exactly.
- **Energy balance**: `dE` per step equals the enthalpy-weighted fluxes over
  1e12 to 9 decimals.
- **Static limit**: zero production/injection/recharge holds T, p, M and E to 9
  decimals over 30 years (the init re-anchor at `p0` is what makes this exact).
- **dt convergence**: monthly vs quarter-monthly temperature agrees to under 2%
  of the temperature span, and halving dt shrinks the error (first-order).
- **Reproducibility**: same seed ⇒ identical trajectories; static columns equal
  the static engine's `inputSeries` index by index; fixing `cTotal` leaves the
  recharge stream untouched at shared indices.
- **Qualitative behaviour**: net extraction declines T, p and E; more production
  drops further; more injection holds pressure higher; injection alone
  repressurises.

## Telemetry (Phase 1.5, `packages/core/test/telemetry.test.ts`)

The sensor layer is held to exactness where exactness is possible, and to
calibrated statistics elsewhere:

- **Zero-noise mode** reproduces hidden truth bit-for-bit (all `ok`, residual 0).
- **Determinism**: same seed ⇒ identical records; different seed ⇒ different
  readings; per-trajectory streams stable under ensemble resizing.
- **Stream isolation**: retuning one channel's sensor leaves every other
  channel's record bit-identical; noise draws are independent of the true
  values themselves.
- **Calibration**: per-channel RMSE lands within 0.7–1.4× of configured σ with
  near-zero mean residual; an injected bias is recovered in the mean residual.
- **Gaps**: dropouts keep the record shape with `missing` + reason; absurd bias
  is `rejected` as out-of-range rather than passed on; counts always reconcile
  (`nOk + nMissing + nRejected = n`).
- **Cadence**: monthly observes every state with matching timestamps;
  coarser cadences subsample without changing the schema; invalid configs throw.
- **Immutability**: observing frozen trajectories leaves them untouched.

## Summary

| Claim | Standard | Result |
|---|---|---|
| IF97 matches the published standard | ~1e−9 relative | Passes |
| Chain obeys the second law and exact linearity | Exact where exact is possible | Passes |
| Monte Carlo is internally consistent | Linearity identity at n = 200,000 | Passes |
| Runs are reproducible and independent per parameter | Exact | Passes |
| Sampler has the right mean, spread and support | Converged at large n | Passes |
| Dynamic tank conserves mass/energy, converges in dt, reproduces exactly | Internal consistency (above) | Passes |
| Telemetry reproduces truth at zero noise, isolates streams, calibrates to σ | Exact + statistical (above) | Passes |
| EnKF corrects a biased prior vs a free-run control, reproduces exactly | Experimental, 3 seeds (above) | Passes |
| Spatial wells stay in-bounds, match the grid, observe reproducibly | Exact + bounded (below) | Passes |

**What this does not establish:** that the volumetric method, the
reduced-order tank, or the synthetic telemetry resemble any real reservoir or
field instrumentation. See `ASSUMPTIONS.md`.

## Assimilation (Phase 2, `packages/core/test/assimilation.test.ts`)

The filter has no external reference either, so it is held to exactness where
exact, statistics where statistical, and a head-to-head experiment overall:

- **Linear algebra**: means, cross-covariances and 1×1/2×2 inverses verified;
  singular covariances throw instead of inverting.
- **Analysis behaviour**: posterior mean moves toward observations, spread
  shrinks, empty observation sets pass forecasts through untouched, per-cycle
  streams reproduce exactly and isolate cycles.
- **Twin experiment** (n = 30, +15 °C prior bias, yearly T/p assimilation):
  initial prior error > 10 °C; final posterior/free error ratio < 0.2 (T) and
  < 0.4 (p) — measured ≈0.02–0.04 and ≈0.05–0.13 across seeds 42, 7, 123;
  spread collapses; every cycle stays liquid-domain physical; same seed
  reproduces cycle-for-cycle.
- **Refactor guard**: extracted `thermalEnergyFromTP`/`instantaneousCapacity`
  reproduce the step's own energy and capacity to 9 decimals.
- **Observation regimes** (Phase 2.5): perfect (zero-noise) observations drive
  the error ratio to ≈0 with no skipped analyses; 40% dropout on both channels
  still validates (ratio < 0.3, many single-channel cycles); 5× sensor noise
  still improves on free (ratio < 0.3 T, < 0.9 p); a two-member ensemble runs
  without collapsing.
- **Posterior states are real model states**: `posteriorToState` rebuilds
  energy/capacity with the forward model's own formulas exactly, preserves
  clock and cumulative meters, survives a further `step()`, and refuses
  unphysical vectors loudly.
- **Innovations**: every used channel records a finite innovation with a
  positive expected std; > 80% of temperature innovations sit inside ±2σ;
  the default run skips no analyses and falls back at most twice.

## Spatial field (Phase 3, `packages/core/test/spatial.test.ts`)

The layout is synthetic geometry, so it is held to exactness; the influence
mapping to bounded consistency:

- **Layout**: every well inside the equal-area ellipse (π·Rx·Ry = A asserted);
  shares sum to 1 per kind; ids stable across seeds while positions jitter;
  footprint scales with area; bad geometry throws.
- **Influence**: zero rates reproduce bulk exactly; producers draw down
  monotonically in rate; injectors-only fields mound above bulk; producer
  cooling stays between injection and bulk temperatures and decays with
  injector distance; extreme drawdown clamps at 0.5 bar with a flag, never
  silently.
- **Grid–well agreement**: nearest inside-cell matches each well within the
  Lipschitz bound (C_q·Q/L × distance); outside cells are flagged NaN.
- **Surveillance**: perfect sensors reproduce truth; per-(well, channel, step)
  streams reproduce exactly, isolate wells, and make step selection
  order-independent; gaps carry flags; inputs never mutated.
- **Bridge**: `conditionsSeries` maps trajectories step-for-step and
  time-stamps through, matching single-step calls exactly.
