# System Architecture

## Guiding principle

Layered, so that physics, uncertainty and presentation stay separable. The physics layer
knows nothing about randomness; the uncertainty layer knows nothing about the UI; the UI
computes nothing itself.

```text
┌─────────────────────────────────────────────┐
│  apps/web — Next.js dashboard                 │
│  charts, tables, controls; no model logic     │
└───────────────────┬────────────────────────┘
                    │ imports @geo/core directly
┌───────────────────▼────────────────────────┐
│  packages/core — @geo/core                    │
│                                               │
│  scenarios ──► monteCarlo ──► physics         │
│                    │              │           │
│              distributions      steam         │
│                    │              │           │
│                   rng          if97           │
│                                               │
│  stats · histogram · sensitivity · validate   │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│  packages/bench — the verification report     │
└─────────────────────────────────────────────┘
```

## Technology

TypeScript throughout, in a pnpm workspace. `@geo/core` has **no runtime dependencies**,
so the identical code runs in Node for verification and in the browser for the dashboard.

The dashboard runs the model client-side: 1,000 realizations recompute in tens of
milliseconds, so there is no API layer, no server round trip, and nothing to keep in
sync. `useDeferredValue` keeps typing responsive while the charts catch up. A route
handler or web worker becomes worth adding only if profiling says so.

IAPWS-IF97 is implemented from the published standard rather than pulled from a library.
That keeps the dependency count at zero, lets the coefficient tables be checked line by
line against the release, and means only the two regions the model actually needs are
carried — an unimplemented region throws rather than silently extrapolating.

Charts are hand-written SVG rather than a charting library. The whole visual system is
driven by CSS custom properties, so light and dark mode work from one palette definition,
and every mark can carry its own accessible label — both awkward to guarantee through a
library's theming API, and neither worth a multi-megabyte dependency.

## Repository layout

```text
.
├── package.json                 # workspace root; `pnpm run dev` lives here
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── docs/
│   ├── PROJECT_OVERVIEW.md
│   ├── MODEL_SPEC.md            # the model, equation by equation
│   ├── ARCHITECTURE.md
│   ├── ASSUMPTIONS.md           # what the model does and does not represent
│   ├── VERIFICATION.md          # what is checked, and to what standard
│   └── ROADMAP.md
├── packages/
│   ├── core/                    # @geo/core
│   │   ├── src/
│   │   │   ├── steam/if97.ts    # IAPWS-IF97 Region 1 + 4
│   │   │   ├── steam/index.ts   # bar / degC facade
│   │   │   ├── physics.ts       # the deterministic chain
│   │   │   ├── validate.ts      # domain guards
│   │   │   ├── rng.ts           # seeded PRNG
│   │   │   ├── distributions.ts # Beta-PERT, triangular, uniform
│   │   │   ├── monteCarlo.ts    # the uncertainty engine
│   │   │   ├── stats.ts
│   │   │   ├── histogram.ts
│   │   │   ├── sensitivity.ts
│   │   │   ├── scenarios.ts
│   │   │   ├── model.ts         # baseline config, MODEL_VERSION
│   │   │   └── types.ts
│   │   └── test/
│   └── bench/
│       └── verify.ts
└── apps/web/
    ├── app/                     # layout, page, design tokens
    ├── components/              # charts, tables, controls
    └── lib/format.ts
```

## Module responsibilities

**`steam/if97.ts`** — the only place thermodynamic equations exist. No other module may
duplicate them.

**`physics.ts`** — pure functions. Returns every intermediate rather than folding the
chain into one expression.

**`distributions.ts` + `rng.ts`** — all randomness lives here. Physics functions never
generate random numbers; every sampler takes an explicit `Rng`.

**`monteCarlo.ts`** — draws realizations, evaluates the chain, returns a complete
simulation record: sampled inputs *and* outputs per realization, plus the provenance
needed to reproduce the run. Each parameter gets its own RNG stream.

**`scenarios.ts`** — a scenario is stored as a **diff** against the baseline, not a full
snapshot, so a baseline change propagates and the scenario's intent stays legible. The
resolved snapshot is recorded on the run.

**`validate.ts`** — rejects physically invalid inputs so a `NaN` can never propagate
through a thousand realizations.

## The simulation record

```text
runId · label · seed · n · modelVersion · timestamp
lifetimeYears · parameters (resolved snapshot)
realizations[] : { index, values, inputs, outputs }
capacityMwe[]
rejected[] : { index, values, reason }
```

`modelVersion` matters because the model will evolve and archived results must stay
interpretable. Bump it whenever a change alters numerical output.

## What is deliberately absent

No API service, no database, no Docker, no state management library, no CSS framework, no
charting library, no ML runtime. Each would be justified by a requirement this project
does not have. `ROADMAP.md` names the point at which some start to earn their place.
