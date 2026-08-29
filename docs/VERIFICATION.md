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
pnpm test      # 74 unit tests
pnpm verify    # the report above
pnpm run dev   # dashboard at localhost:3000
```

## Summary

| Claim | Standard | Result |
|---|---|---|
| IF97 matches the published standard | ~1e−9 relative | Passes |
| Chain obeys the second law and exact linearity | Exact where exact is possible | Passes |
| Monte Carlo is internally consistent | Linearity identity at n = 200,000 | Passes |
| Runs are reproducible and independent per parameter | Exact | Passes |
| Sampler has the right mean, spread and support | Converged at large n | Passes |

**What this does not establish:** that the volumetric method is a good model of a real
reservoir, or that the demonstration inputs describe anything. See `ASSUMPTIONS.md`.
