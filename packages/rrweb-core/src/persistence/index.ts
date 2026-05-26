// Public barrel for the IndexedDB persistence module.
//
// Locked surface per IMPLEMENTATION_PLAN.md Public API contract (line 726):
//
//   export { createSessionStore, type SessionChunk } from './persistence';
//
// The factory + companion `SessionStore` / `SessionStoreOptions` types
// are re-exported so consumers can declare-and-pass without reaching
// into `./store` directly.

export { createSessionStore } from './store';
export type { SessionChunk, SessionStore, SessionStoreOptions } from './types';
