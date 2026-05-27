// Public barrel for the masking module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract
// (lines 691-693): the four functions below plus `COMPAT_SELECTORS`. The
// internals (regex bank, individual matchers, helpers) stay internal.

export { maskInputValue } from './inputs.js';
export { maskTextContent } from './text.js';
export { redactNetworkHeaders } from './headers.js';
export { redactBody } from './body.js';
export type { RedactBodyOptions } from './body.js';
export { COMPAT_SELECTORS } from './selectors.js';
export type { CompatSelectorFamily } from './selectors.js';
