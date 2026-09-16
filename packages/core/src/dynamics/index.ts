/**
 * `@geo/core/dynamics` — reduced-order dynamic tank model (Phase 1).
 *
 * A synthetic lumped model, not a high-fidelity reservoir simulator. The
 * static assessment in `..` characterises the reservoir; this module evolves
 * it in time under prescribed production and injection.
 */
export * from './types.js';
export * from './params.js';
export * from './schedule.js';
export * from './init.js';
export * from './step.js';
export * from './ensemble.js';
