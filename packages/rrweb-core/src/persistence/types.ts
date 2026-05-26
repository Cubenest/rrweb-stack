// IndexedDB persistence types — Task 1.10.
//
// Public shapes for the IDB-backed chunk store used by the @peekdev extension
// to persist rrweb recordings across MV3 service-worker restarts. Tracelane
// ignores this module — its self-contained HTML report path doesn't need
// crash-safe persistence.
//
// A "chunk" is the output of `compress(events)` — gzipped event bytes that
// land here as-is. The store does NOT decode them; the caller round-trips
// via `decompress` (see ../compression).
//
// Public API contract (IMPLEMENTATION_PLAN.md line 726):
//
//   export { createSessionStore, type SessionChunk } from './persistence';
//
// The factory and the chunk type are the "locked" surface. The store
// interface and options interface are re-exported for declare-and-pass
// ergonomics but are not part of the contract line; their shape can
// evolve under semver.

/**
 * One stored chunk: a gzipped rrweb-event batch plus the bookkeeping the
 * store assigns at append time. `seq` is monotonically increasing per
 * session; `ts` is the wall-clock at append; `bytes` is the gzipped output
 * of `compress()`, persisted verbatim and never re-encoded by the store.
 *
 * `meta` is an opt-in escape hatch for adapter-supplied metadata
 * (e.g. `{ url, isFirst, viewportWidth }`). Keys are plain strings;
 * values are restricted to JSON-safe scalars so the structured-clone
 * write path stays predictable across browsers.
 */
export interface SessionChunk {
  /** Monotonically increasing per session. The store assigns this on append. */
  readonly seq: number;
  /** ms epoch when the chunk was created. */
  readonly ts: number;
  /** Gzipped event bytes (from compress()). Persisted as-is. */
  readonly bytes: Uint8Array;
  /** Optional adapter-supplied metadata. */
  readonly meta?: Record<string, string | number | boolean>;
}

/**
 * The handle returned by `createSessionStore`. All operations are async
 * and back onto the underlying IDB connection opened by the factory.
 *
 * Operations don't share transactions — each call opens its own. This is
 * the safest pattern under IndexedDB's "transactions auto-close at the
 * end of the current task" rule: holding a transaction across an `await`
 * boundary is undefined behaviour on most engines and outright broken on
 * Safari. The internal helper wraps each `IDBRequest` in a Promise that
 * resolves on `onsuccess` and rejects on `onerror`.
 *
 * After `close()`, every subsequent op rejects with an Error rather than
 * silently queueing — callers can race on the rejection to decide whether
 * to reopen.
 */
export interface SessionStore {
  /** The session id this store was opened for. Immutable after construction. */
  readonly sessionId: string;
  /** Append a chunk. Returns the assigned seq. */
  append(bytes: Uint8Array, meta?: SessionChunk['meta']): Promise<number>;
  /** Read chunks with seq in [fromSeq, toSeq] inclusive (toSeq optional = unlimited). */
  read(fromSeq: number, toSeq?: number): Promise<SessionChunk[]>;
  /** Read the last N chunks. */
  readLastN(n: number): Promise<SessionChunk[]>;
  /** Total chunk count for the session. */
  size(): Promise<number>;
  /** Total compressed bytes across all chunks for the session. */
  totalBytes(): Promise<number>;
  /** Delete chunks with seq < beforeSeq (used by the extension to keep recent-N). */
  prune(beforeSeq: number): Promise<number>;
  /** Delete every chunk for this session. */
  clear(): Promise<void>;
  /** Close the underlying IDB connection. */
  close(): Promise<void>;
}

/**
 * Options for `createSessionStore`. Every field is optional; defaults
 * are picked so a plain `createSessionStore(sessionId)` call works in
 * any browser that exposes `globalThis.indexedDB`.
 *
 * `indexedDB` is the test/polyfill seam. Pass `fake-indexeddb`'s factory
 * here in unit tests, or your environment's polyfill in non-standard
 * runtimes (worker shims, jsdom, etc.). When omitted, the store reads
 * `globalThis.indexedDB` at construction time and throws if it's
 * undefined — fail fast beats lazy null-deref.
 */
export interface SessionStoreOptions {
  /** IDB database name. Default '@cubenest/rrweb-core'. */
  dbName?: string;
  /** IDB object-store name. Default 'session-chunks'. */
  storeName?: string;
  /** Optional injection for tests / non-browser environments. */
  indexedDB?: IDBFactory;
}
