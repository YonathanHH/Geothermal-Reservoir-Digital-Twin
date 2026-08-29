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
| Dynamic reduced-order model | Later |
| ML surrogate | Later |
| Data assimilation | Later |

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

### High-fidelity simulation and ML surrogate

`TOUGH2 / PyTOUGH → simulation dataset → surrogate → fast inference`. Start with one
output target. Benchmark prediction error, inference speed and robustness across the
training domain; never evaluate a surrogate outside its validated domain.

This is the point where a Python component genuinely earns its place. The TypeScript-only
stack is a deliberate fit to the current scope, not a permanent commitment.

### Data assimilation

Wellhead pressure and temperature, production and injection rates, downhole measurements.
Recursive parameter calibration or a Kalman-filter-style framework.

**This is the phase that would make "digital twin" an honest description.** Until dynamic
observations are actually assimilated, the term stays out of the documentation.

### Natural-language analyst

A presentation layer over deterministic tools — `get_current_state`, `forecast_pressure`,
`compare_scenarios`, `get_uncertainty`. It explains model outputs and assumptions; it
never invents reservoir calculations or overrides a deterministic result. Worth building
only once the scientific core is stable, or it becomes a demo with nothing underneath.
