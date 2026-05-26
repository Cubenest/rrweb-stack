// Public barrel for the masking module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract
// (lines 691-693): the four functions below plus `COMPAT_SELECTORS`. The
// internals (regex bank, individual matchers, helpers) stay internal.

export { maskInputValue } from './inputs';
export { maskTextContent } from './text';
export { redactNetworkHeaders } from './headers';
export { redactBody } from './body';
export type { RedactBodyOptions } from './body';
export { COMPAT_SELECTORS } from './selectors';
export type { CompatSelectorFamily } from './selectors';
