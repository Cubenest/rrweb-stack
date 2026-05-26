// Public barrel for the throttling module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract
// (lines 695-696): the `LARGE_DOM_DEFAULTS` constant plus the
// `applyLargeDomGuards` function. The guard implementations
// (`applyDataUrlGuard`, `applyEventSizeGuard`, `applyMutationGuard`) and the
// SVG placeholder constant stay internal — they're composed by
// `applyLargeDomGuards` and not intended for direct consumption.

export { LARGE_DOM_DEFAULTS } from './defaults';
export type { LargeDomDefaults } from './defaults';
export { applyLargeDomGuards } from './apply';
export type { ApplyLargeDomGuardsOptions } from './apply';
