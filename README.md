# Geothermal Resource Assessment

Physics-informed probabilistic modelling of geothermal generation capacity — a
volumetric "heat in place" assessment with Monte Carlo uncertainty propagation, built
in TypeScript with an interactive dashboard.

```bash
pnpm install
pnpm run dev      # dashboard at http://localhost:3000
```

---

## What it does

Given a three-point estimate (minimum, most likely, maximum) for each reservoir
property, the model estimates the electrical generation capacity a geothermal field
could sustain over a project lifetime, and quantifies how uncertain that estimate is.

The method is the standard USGS volumetric one (Circular 790, 1978):

```
thermal energy in place  →  recoverable fraction  →  available work (exergy)
                         →  electrical energy     →  average capacity
```

Every step is evaluated with real water/steam properties from IAPWS-IF97, and every
intermediate is exposed rather than folded into a single number.

For the bundled synthetic demonstration field, at 1,000 realizations:

| | Capacity |
|---|---:|
| **P90** (conservative) | 8.9 MWe |
| **P50** (median) | 16.2 MWe |
| **P10** (optimistic) | 27.9 MWe |

## The dashboard

Four views, all computed client-side — there is no API and no server round trip:

- **Overview** — headline percentiles and the deterministic chain rendered step by step,
  every intermediate labelled with its unit.
- **Monte Carlo** — capacity histogram and exceedance curve, with summary and exceedance
  tables.
- **Inputs & sensitivity** — an editable input table, plus a tornado chart of what drives
  the spread.
- **Scenario lab** — named scenarios compared on a shared seed, so differences are the
  effect of the change rather than of resampling.

## Design notes

A few decisions that are easy to get wrong, and are made deliberately here:

**Beta-PERT is sampled through the inverse CDF.** Applying the forward CDF to a uniform
draw is a quiet failure mode: it compiles, runs, produces numbers inside the right range,
and yields the wrong distribution. In the symmetric case it degenerates all the way to a
uniform draw — discarding the most-likely value entirely and inflating the spread, giving
a P10 far too optimistic with nothing in the output that looks wrong.

**The symmetry test uses a tolerance, not exact equality.** `(0.35 + 4*0.4 + 0.45) / 6`
is `0.4000000000000001` in IEEE-754, not `0.4`. Miss that branch and the PERT shape
parameters are computed from a ratio of two rounding errors — which can come out
negative, i.e. not a distribution at all.

**Each parameter draws from its own RNG stream.** With one shared stream, changing a
single input — even just fixing it, which consumes no draws — shifts every subsequent
parameter's numbers, and a scenario comparison would mix the effect of the change with
the effect of a reshuffled stream.

**Fixed inputs disable their min and max.** They contribute no uncertainty, so leaving
those fields editable would invite someone to widen a range and wonder why the result
never moves.

**Invalid inputs throw.** Negative area, a temperature outside the IF97 liquid domain, an
ambient temperature above the reservoir's — all rejected by name, rather than propagating
a `NaN` into a plausible-looking percentile.

**No dual-axis charts.** The histogram and the cumulative curve get their own frames. Two
scales on one frame invite the reader to compare series that are not comparable.

## Verification

```bash
pnpm test      # 74 unit tests
pnpm verify    # human-readable verification report
```

Three kinds of claim, held to different standards:

| Claim | Standard |
|---|---|
| Thermodynamic properties | Exact, against the published IAPWS-IF97 verification points (Tables 5, 7, 35, 36) — agreement to ~1e−9, the precision of the published values themselves |
| Internal consistency | Capacity is exactly linear in area, thickness, recovery and utilization, so `slope × mean(input)` must equal `mean(capacity)`. Checked at n = 200,000 |
| Reproducibility | Same seed ⇒ identical run, always |

The linearity identity is the load-bearing one: it exercises the physics, the sampler and
the statistics simultaneously, and needs no external reference data.

## Architecture

```
packages/core     @geo/core — physics, thermodynamics, sampling, statistics.
                  Zero runtime dependencies; runs in Node and in the browser.
packages/bench    The verification report.
apps/web          Next.js dashboard. Hand-written SVG charts, theme-aware.
docs              Model spec, assumptions, architecture, verification, roadmap.
```

`@geo/core` has no runtime dependencies, so the same code that the dashboard runs is the
code the tests verify. IAPWS-IF97 Region 1 and Region 4 are implemented from the
published standard rather than pulled from a library, so the coefficient tables can be
checked line by line.

## Commands

| Command | What it does |
|---|---|
| `pnpm run dev` | Dashboard at `localhost:3000` |
| `pnpm test` | Unit tests |
| `pnpm verify` | Verification report |
| `pnpm build` | Production build |
| `pnpm typecheck` | Strict TypeScript check |

## Documentation

| Document | What it answers |
|---|---|
| [`PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md) | What this is and what it claims |
| [`MODEL_SPEC.md`](docs/MODEL_SPEC.md) | The model, equation by equation |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the code is organised and why |
| [`ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) | What the model does and does not represent |
| [`VERIFICATION.md`](docs/VERIFICATION.md) | What is checked, and to what standard |
| [`ROADMAP.md`](docs/ROADMAP.md) | What is built and what comes next |

## Scope

This is a **static probabilistic resource assessment**. There is no time dimension, no
production or injection controls, and no assimilation of operational data — so it is not
a digital twin, and the docs are careful not to call it one. `ROADMAP.md` sets out what
adding time would take.

The bundled inputs describe a **synthetic demonstration field**. They are illustrative
values in a plausible range, not an assessment of any real asset.

## Deploying

The dashboard deploys to Vercel from `apps/web`. Configuration lives in
[`apps/web/vercel.json`](apps/web/vercel.json); the only setting that cannot be
expressed there is the root directory, which is set in the Vercel project:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Include files outside root directory | enabled — the build needs `packages/core` and the root lockfile |
| Framework / Build / Install / Output overrides | none — `vercel.json` supplies them |

`packages/core` needs no build step of its own: it ships TypeScript source and
`next.config.mjs` transpiles it, so `next build` is the whole pipeline.

## Licence

MIT — see [LICENSE](LICENSE).
