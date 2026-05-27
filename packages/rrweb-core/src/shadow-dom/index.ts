// Public barrel for the shadow-DOM module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract (lines
// 715-716): the `traverseShadowRoots` function plus the `ShadowRootInfo`
// type. The traversal options interface stays internal — callers pass an
// inline object literal and TS infers the shape.

export { traverseShadowRoots } from './traverse.js';
export type { ShadowRootInfo } from './types.js';
