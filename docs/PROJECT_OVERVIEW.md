# Project Overview

## Purpose

A modular, testable implementation of the USGS volumetric method for geothermal resource
assessment, with Monte Carlo uncertainty propagation and an interactive dashboard.

The aim is a model whose numbers can be **traced and checked** — every intermediate
exposed, every assumption written down, every claim verified against something — rather
than one that merely produces plausible output.

## What it delivers

1. The deterministic volumetric chain as pure, unit-aware functions.
2. Monte Carlo uncertainty propagation with reproducible seeding.
3. Summary statistics, exceedance curves and sensitivity analysis.
4. Scenario definition and comparison.
5. An interactive dashboard.

## What to claim, and what not to

> A physics-informed geothermal resource model that propagates uncertainty from
> three-point input estimates to a probabilistic generation-capacity forecast, with
> thermodynamics verified against IAPWS-IF97 and a scenario comparison interface.

That is defensible; `VERIFICATION.md` is the evidence.

**Do not call this a digital twin.** A twin tracks a real asset by assimilating
observations of it. This model has no time dimension and consumes no operational data.
The honest description is *a static probabilistic resource assessment with scenario
analysis*. `ROADMAP.md` sets out what the term would require.

## Priorities

1. correctness
2. traceability
3. testability
4. reproducibility
5. usability
6. advanced features

Scientific traceability outranks flashy capability. This ordering is what keeps the
project from becoming a demonstration with weak engineering underneath.

## Design principles

**Expose every intermediate.** A model that emits one number can only be believed or
disbelieved. One that emits the whole chain can be checked, and a wrong answer localised
to the step that produced it.

**Fail loudly on invalid input.** Physically impossible inputs throw, naming the field.
The alternative — a `NaN` propagating into a percentile that still looks like a number —
is the worst outcome for a model someone might act on.

**Keep randomness out of the physics.** Physics functions are pure. Sampling lives in its
own layer with an explicit generator, so the deterministic chain can be tested exactly.

**Write down what the model does not do.** `ASSUMPTIONS.md` is a first-class deliverable,
not an appendix. The limits of a resource estimate matter as much as its value.

**Prefer implementing a standard to depending on one.** IAPWS-IF97 is implemented
directly, so the coefficients can be checked against the published release and only the
regions actually needed are carried.

## Status

| Capability | State |
|---|---|
| Deterministic chain | Done |
| Monte Carlo engine | Done |
| Statistics, exceedance, sensitivity | Done |
| Scenario comparison | Done |
| Dashboard | Done |
| Time dimension / dynamic model | Not started |
| ML surrogate | Not started |
| Data assimilation | Not started |

## Data

The bundled inputs describe a **synthetic demonstration field** — illustrative values in a
plausible range, not an assessment of any real asset. Never commit confidential
operational data to this repository.
