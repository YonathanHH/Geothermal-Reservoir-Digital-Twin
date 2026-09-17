# Roadmap

## Status

| Capability | State |
|---|---|
| Deterministic volumetric chain | **Done** |
| IAPWS-IF97 thermodynamics (Regions 1 and 4) | **Done** |
| Monte Carlo engine with per-parameter seeding | **Done** |
| Statistics, exceedance curve, histogram | **Done** |
| Sensitivity analysis | **Done** |
| Scenario definition and comparison | **Done** |
| Dashboard | **Done** |
| Correlated inputs | Next |
| Sobol sensitivity indices | Next |
| Export | Next |
| Dynamic reduced-order model | Phase 1 done (tank + ensemble, no assimilation) |
| Synthetic field telemetry | Phase 1.5 done (observation layer, no assimilation) |
| ML surrogate | Later |
| Data assimilation | Phase 2 done (EnKF prototype on synthetic truth) |
| Twin hardening + validation | Phase 2.5 done (regimes, innovations, consistency guards) |
| Spatial digital twin | Phase 3 done (wells, influence map, assimilation-linked views; control-room refinement with fixed-scale layers and synchronized time, no model changes) |
| Operational forecasting | Phase 4 done (scenario forecasts, alerts, outlook — no autonomy; twin view branches its updated forecast from the latest estimate) |

---

## Next — cheap and worth doing

### Correlated inputs

Every input is currently sampled independently, which overstates the spread for
positively correlated properties (area and thickness often share a structure;
temperature and recovery both depend on permeability). A correlation matrix with a
Gaussian copula, or Iman–Conover rank correlation, would fix this without disturbing the
marginal distributions the user specified.

This is the single change most likely to alter the quoted P90–P10 band.

### Sobol sensitivity indices

Pearson correlation assumes linearity, and capacity is not linear in temperature or
porosity (`ASSUMPTIONS.md` §7). Variance-based Sobol indices would attribute influence
correctly for those, and would separate first-order from interaction effects. Report them
alongside the existing columns, clearly labelled — never mixed.

### Latin hypercube sampling

Better coverage of the input space at the same N, so the tails stabilise faster.

### Export

Realizations to CSV, the run record to JSON. Results currently cannot leave the browser,
which limits the model's usefulness as an input to anything else.

### User-defined scenarios

The scenario lab ships a fixed illustrative set. User-defined scenarios need persistence
and a share format — a URL-encoded configuration would suit the client-side architecture.

---

## Later — larger, and each needs its own justification

### Dynamic reduced-order model

Introduce time. State variables: reservoir pressure and temperature, production and
injection rate, cumulative energy, generation capacity.

```
x_(t+1) = f(x_t, u_t, θ) + process noise
```

The first version would be reduced-order engineering relationships, not a numerical
reservoir simulator. **This is the phase where invented physics enters the project**, and
every equation needs an `ASSUMPTIONS.md` entry stating what it represents and what it does
not. The static model becomes the initialisation layer.

*Done when* a multi-year scenario produces time-series output with uncertainty bands.

Phase 1 (done, `packages/core/src/dynamics/`, `DYNAMICS_VERSION 0.1.0`): monthly
tank mass/energy balance over 30 years with explicit pressure state, prescribed
production/injection controls, static-model initialisation, and a seeded
ensemble runner. No well models, no pressure-target control, no assimilation —
those stay below.

Phase 1.5 (done, `packages/core/src/telemetry/`, `TELEMETRY_VERSION 0.1.0`):
synthetic observation layer over recorded trajectories — one production well
plus plant, Gaussian meter noise on isolated per-channel streams, dropouts and
refusals as explicit quality flags, monthly cadence, flat `TelemetryPoint`
handoff records with truth, residual and units. No assimilation: the records
are the boundary Phase 2 will consume.

### High-fidelity simulation and ML surrogate

`TOUGH2 / PyTOUGH → simulation dataset → surrogate → fast inference`. Start with one
output target. Benchmark prediction error, inference speed and robustness across the
training domain; never evaluate a surrogate outside its validated domain.

This is the point where a Python component genuinely earns its place. The TypeScript-only
stack is a deliberate fit to the current scope, not a permanent commitment.

### Data assimilation

Wellhead pressure and temperature, production and injection rates, downhole measurements.
Recursive parameter calibration or a Kalman-filter-style framework.

Phase 2 (done, prototype, `packages/core/src/assimilation/`,
`ASSIMILATION_VERSION 0.1.0`): stochastic EnKF on state [T, p, M] with the
tank `step()` as forward model, wellhead T/p telemetry as observations, and a
twin experiment (biased prior + free-run control) showing ~95%+ error
reduction on synthetic truth. State estimation only — no parameter
calibration, no real data. Remaining: parameter estimation, model-error
treatment, real telemetry.

Phase 3 (done, `packages/core/src/spatial/`, `SPATIAL_VERSION 0.1.0`):
deterministic disaggregation of tank bulk state onto a synthetic well field
(inner-ring producers, peripheral injectors, central observation well) via
superposed influence cones, plus per-well surveillance with isolated streams.
The "Field map" dashboard tab renders truth vs posterior spatial states from
twin trajectories over a time slider. No flow simulation, no well-level
assimilation yet — those stay below.

**This is the phase that would make "digital twin" an honest description.** Until dynamic
observations are actually assimilated, the term stays out of the documentation.

### Natural-language analyst

A presentation layer over deterministic tools — `get_current_state`, `forecast_pressure`,
`compare_scenarios`, `get_uncertainty`. It explains model outputs and assumptions; it
never invents reservoir calculations or overrides a deterministic result. Worth building
only once the scientific core is stable, or it becomes a demo with nothing underneath.

### Operational forecasting

Phase 4 (done, `packages/core/src/operations/`, `OPERATIONS_VERSION 0.1.0`):
forecasts branching from estimated states, what-if scenarios as rate diffs,
threshold-rule alerts and remaining-capacity outlooks, all composed from
existing deterministic tools. The "Operations" dashboard tab presents field
status, forecast with uncertainty, scenario comparison, alerts and outlook.
No autonomy, no language models, no real-world performance claims — decision
support over a synthetic reduced-order twin.
