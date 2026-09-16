# Assumptions and Limitations

What the model represents, what it does not, and the judgement calls behind each. If you
are deciding whether to trust a number this produces, read this page first.

---

## 1. The volumetric method itself

The model implements the USGS volumetric "heat in place" method. Its core assumption is
that the resource can be described as a **single well-mixed block** of rock and water at
one temperature, of which some fraction of the stored heat is recoverable.

That is a strong simplification. It does not represent:

- spatial variation in temperature, permeability or porosity;
- fluid flow, so no pressure drawdown, no interference between wells, no reinjection
  breakthrough;
- how the resource declines over time — the capacity figure is an average over the
  project life, not a production profile;
- two-phase behaviour, boiling zones or vapour caps;
- chemistry, scaling or reservoir mechanics.

The recovery factor `R` is where all of that hides. It is a single number standing in for
the entire question of how much of the heat in the ground can actually be produced, and
it is typically the input with the widest genuine uncertainty. Treat a narrow range on
`R` with suspicion.

**What the output means.** "P90 = 8.9 MWe" says: given these input ranges and this
method, 90% of realizations achieved at least 8.9 MWe. It does not say a plant will
deliver that. Method error is not in the error bars.

## 2. Beta-PERT, and the inverse CDF

Inputs default to Beta-PERT: a Beta distribution reparameterised so its mean is
`(min + 4·mostLikely + max) / 6`. It is the usual choice when experts can state a range
and a most-likely value but not a variance.

Sampling it requires the **inverse** CDF applied to a uniform draw. This is worth stating
because the opposite mistake is easy and quiet: applying the forward CDF compiles, runs,
produces numbers inside the right range, and yields the wrong distribution. In the
symmetric case it degenerates to a uniform draw — discarding the most-likely value
entirely and inflating the spread. The result is a P10 far too optimistic, with nothing
in the output that looks wrong.

`betaCdf` therefore exists only to build `betaInv`. It is never used to sample.

A related trap: the symmetric case must be detected with a **tolerance**, not exact
equality. `(0.35 + 4*0.4 + 0.45) / 6` evaluates to `0.4000000000000001` in IEEE-754
doubles, not `0.4`. Fall through that branch and the shape parameters are computed from a
ratio of two rounding errors, which can come out negative — not a distribution at all.
`SYMMETRY_EPSILON` in `distributions.ts` is that tolerance.

## 3. Inputs are sampled independently

Every input is drawn independently. That is almost certainly wrong in reality:

- area and thickness are often related through the same geological structure;
- temperature and recovery factor both depend on permeability;
- porosity and rock heat capacity are both functions of lithology.

Independent sampling of positively correlated inputs **overstates** the spread — the
extremes require several independent variables to be extreme at once, which is less
likely than the correlated case. The P90–P10 band is therefore probably wider than the
true uncertainty in the resource, while remaining narrower than the true uncertainty in
the *answer*, because method error is excluded entirely.

Adding a correlation structure is on the roadmap.

## 4. Fixed inputs contribute no uncertainty

Four inputs are `Fixed` by default (rock heat capacity, depth, ambient temperature,
capacity factor), and project lifetime is not sampled at all. Their uncertainty is
excluded from the quoted range by construction.

This is a defensible default — they are usually known far better than the reservoir
properties — but it is a choice, not a fact. Ambient temperature in particular varies
seasonally and does affect available work. The dashboard disables the min/max fields for
`Fixed` inputs rather than leaving them editable and inert.

## 5. Thermodynamics

Water and steam properties come from IAPWS-IF97, implemented directly from the published
standard in `packages/core/src/steam/`.

**Only Region 1 (compressed liquid) and Region 4 (the saturation line) are implemented.**
That covers liquid-dominated geothermal systems, which is the domain this model is
defined for. Regions 2, 3 and 5 are absent, and any call outside 0–350 °C throws rather
than extrapolating. A vapour-dominated or supercritical resource is **out of scope** —
the model will refuse rather than mislead.

Two details worth knowing:

- Properties are evaluated at `1.001 × psat(T)` rather than exactly on the saturation
  line, so a region-detection routine cannot return the two-phase branch and hand back a
  heat capacity that is not the liquid's.
- The IF97 **backward** equation `T(p,h)` is specified to about 25 mK, so a round trip
  through it recovers entropy only to ~2×10⁻⁴ kJ/(kg·K). Propagated through the
  `Ta·(sWH − so)` term, that is well under 0.1% of the available work — negligible here,
  but it is why the entropy round-trip test uses a 5×10⁻⁴ band rather than machine
  precision.

## 6. Exergy, not a plant model

Available work is the thermodynamic maximum: the exergy of the produced fluid relative to
the ambient sink. The utilization factor `u` then stands in for everything a real power
plant does — turbine efficiency, parasitic load, condenser performance, cycle choice.

So the model does not distinguish a flash plant from a binary one except through the
value of `u`. If you are comparing conversion technologies, this is the wrong tool.

## 7. Sensitivity analysis assumes linearity

The tornado chart uses Pearson correlation and OLS slope. Capacity is **exactly** linear
in area, thickness, recovery and utilization, so the statistic is well founded for those.

It is **not** linear in temperature — which enters through the steam properties, the
temperature difference and the enthalpy drop — nor in porosity. Their correlations
understate a genuinely nonlinear influence.

Spearman rank correlation is computed alongside and reported separately. Sobol indices
would be the right tool for the nonlinear inputs and are on the roadmap. Methods are
never mixed within a column.

## 8. Reproducibility and randomness

mulberry32, seeded explicitly. Each parameter draws from its **own** stream, derived from
the run seed and the parameter name.

That last point is not cosmetic. With a single shared stream, changing one input — even
just fixing it, which consumes no draws — shifts every subsequent parameter's numbers, so
a scenario comparison would mix the effect of the change with the effect of a reshuffled
stream. Per-parameter streams mean an untouched input draws identical values regardless
of what else was edited.

Monte Carlo error itself remains: at n = 1000 the mean carries a standard error of
roughly 1.5%, and the extreme percentiles considerably more. Raise n before reading much
into a small difference between scenarios.

## 9. The demonstration inputs are synthetic

The bundled parameters describe an invented field, chosen to sit in a plausible range for
a liquid-dominated resource. They are not an assessment of any real asset and must not be
presented as one.

## 10. Scope: this is not a digital twin

There is no assimilation of measurements. The honest description is **a static
probabilistic resource assessment with scenario analysis plus a reduced-order
synthetic dynamic model**.

A digital twin tracks a real asset by ingesting observations of it. `ROADMAP.md`
sets out what that would take; until it exists, the term is not used here.

## 11. The dynamic tank model (Phase 1)

Section 11 of `MODEL_SPEC.md` is a reduced-order synthetic reservoir model, not
a high-fidelity reservoir simulator. Every equation below states what it
represents and what it does not.

**Lumped tank.** One well-mixed block: no spatial gradients, no wells, no
flow paths, no boiling front, no chemistry or scaling, no rock mechanics. The
temperature is single-valued by construction, so thermal breakthrough and
short-circuiting cannot appear.

**Explicit Euler with frozen properties.** Each step evaluates density, heat
capacity and enthalpies at the incoming state and holds them over `dt`. The
update is first-order exact only as `dt → 0`; the dt-convergence test pins the
monthly-step error to under ~2% of the temperature span against a quarter-step
reference. Halving the step must shrink the error.

**Pressure is a linearised storage response, decoupled from temperature.**
`dp = dM / (ρ·Vp·cTotal)` treats the tank as a confined liquid volume with a
single effective compressibility, and temperature enters only through the frozen
density. There is no saturation coupling, no two-phase buffering and no
geomechanical feedback. `cTotal` is centred an order of magnitude above pure
liquid + pore compressibility precisely because it stands in for fracture
compliance and boundary support the tank does not resolve — treat it as a
tuning/storage parameter, never as a laboratory measurement.

**Recharge is constant and thermally neutral.** It adds mass at reservoir
enthalpy `hL(T_t)`, i.e. it dilutes nothing and cools nothing. Real recharge is
cooler and often pressure-dependent; this choice is the least arbitrary option
that needs no extra parameters, and it keeps the recharge contribution small by
default (most-likely 2 kg/s against 80 kg/s of production).

**Injection is fully mixed at 60 °C with no pressure dependence.** Enthalpy is
`hL(T_inj)`; injection pressure is ignored. The enthalpy providers are
injectable so `hPT(p, T)` can replace `hL(T)` later without an API redesign.

**Initial pressure is hydrostatic-or-saturated, whichever is higher.** Where a
hot, shallow static realization has a water column below its saturation
pressure, V1 pressurises the feed zone to `1.001 × psat` rather than rejecting
the realization. That is an assumption about the feed zone, stated here so it
can be revisited with depth-dependent pressure data.

**Refusal instead of extrapolation.** Mass depletion, non-positive pressure, or
a temperature leaving the IF97 liquid domain throws per step and lands in the
ensemble `rejected[]` with the step index and reason. A small tank cannot
sustain a large rate for 30 years; the model says so loudly.

**`P_inst` is not the static capacity.** The instantaneous diagnostic answers
"what does this rate deliver at this state", while the static chain answers
"what average capacity does the whole stock sustain over the project life".
Comparing the two numbers directly is a category error.

## 12. The synthetic telemetry layer (Phase 1.5)

Section 12 of `MODEL_SPEC.md` is a measurement model, not a reservoir model.
It adds observation uncertainty, sampling behaviour and recording failures —
nothing else. Every new assumption is listed here.

**All telemetry is synthetic.** No reading in this system ever came from a real
well, plant or meter. Sensor noise stands in for instrument precision (a meter
never reads the dial exactly); it knows nothing about reservoir physics and
must never be interpreted as process variability.

**One production well and one plant.** PW-01 plus plant meters is the whole
field. Distinct wells with distinct conditions would require a spatially
resolved reservoir, which the lumped tank is not. Do not present multi-well
behaviour from this system.

**Sensors observe bulk tank conditions directly.** There are no wellbore
hydraulics, no drawdown between sandface and wellhead, no heat loss up the
well, and no spatial gradients. A reported temperature or pressure is the tank
value plus noise — an optimistic view of observability, stated plainly.

**Noise is absolute, Gaussian and unbiased by default.** No drift, no
fouling, no correlated or common-mode failures, no heteroscedasticity. The
sigmas are plausible meter accuracies, not calibrated error models. Bias is
supported but defaults to zero.

**Gaps are dropouts or refusals, and the reservoir keeps running.** A `missing`
point is a scheduled reading that never arrived; a `rejected` point arrived
outside physical plausibility and was refused rather than passed downstream.
Neither affects the dynamics, which were recorded before observation. Charts
break at gaps instead of interpolating across them.

**Monthly cadence.** The V1 observation rhythm matches the monthly reservoir
step. Weekly or daily sampling would need sub-step interpolation of the tank,
which is not implemented; the record's continuous timestamps keep that door
open without changing the schema.

**What this prepares for.** The flat `TelemetryPoint` record (true value,
observed value, residual, quality, reason, units) is the boundary a Phase-2
state estimator will consume — at which point THESE synthetic readings can be
swapped for real ones without rewriting the reservoir model. Until real
observations are actually assimilated, "real-time digital twin" stays out of
the documentation.

## 13. The state estimator (Phase 2)

Section 13 of `MODEL_SPEC.md` is a prototype ensemble filter on a synthetic
tank — encouraging results here validate the *loop* (forecast → observe →
correct), not readiness for a real field. New assumptions:

**Gaussianity is assumed, not shown.** The EnKF is optimal only for linear
Gaussian systems; the tank is nonlinear (exergy, saturation pressure) and the
ensemble is small (25–100). It works here because the observation operator is
linear and the prior stays roughly unimodal. Multimodal posteriors (e.g.
boiling transitions, which the tank cannot represent anyway) would break it
silently — the spread would look confident and be wrong.

**Only wellhead T and p are assimilated.** Rates are treated as perfectly
known controls and generation as a deterministic diagnostic. Real meters have
their own biases and real rates are uncertain; folding those in would need an
augmented state or parameter estimation, which is future work — the filter
currently estimates dynamic state only, never parameters.

**The experiment is favourably configured.** Truth and ensemble share the same
tank equations (no model error), the same schedule, and well-observed channels
with small noise. The +15 °C prior bias is large and directly observed, so a
~95%+ error reduction flatters the method. Real twin performance would be
worse on every axis: model error, sparser data, unknown biases.

**Ensemble collapse is guarded, not solved.** The 2×2 inverse throws on a
non-positive determinant; with tiny ensembles or overconfident R the filter
can still become overconfident gradually. Skipped analyses and posterior
fallbacks are counted separately (`analysisSkipped` vs `totalFallbacks`) so a
sick filter cannot hide in a single number. Inflation exists but defaults off;
watch the spread — and the innovation envelope — not just the mean.

**Innovation coverage flatters a conservative filter.** The expected envelope
includes prior spread, so ~100% in-envelope readings mean the uncertainty is
honest-or-wide, not perfectly calibrated. The diagnostic rules out
overconfidence; it cannot rule out underconfidence.

**"Digital twin" now means prototype.** The dashboard tab earns the name only
in the synthetic sense: a simulated field, simulated meters, and estimation
closing the loop. No real asset, no real data, no real-time operation.
