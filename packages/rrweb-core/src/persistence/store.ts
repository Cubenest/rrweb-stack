// IndexedDB-backed session chunk store — Task 1.10.
//
// `createSessionStore(sessionId)` opens (or creates) the @cubenest/rrweb-core
// IDB database, returns a `SessionStore` handle whose methods append/read
// gzipped event chunks keyed by `[sessionId, seq]`. The store is purpose-
// built for one consumer (@peekdev's MV3 extension) and one shape of
// payload (the `Uint8Array` output of `../compression`); we keep the
// abstraction deliberately thin per ADR-0002's "core stays minimal" pact.
//
// Why a separate seq column (vs. autoIncrement on the object store)?
//   - autoIncrement is per-store, not per-session. With many sessions
//     interleaved, the keys would still be globally monotonic but the
//     per-session sequence would have gaps, defeating range reads.
//   - A composite primary key of `[sessionId, seq]` lets us range-scan
//     by session cheaply via the natural keyspace ordering. No secondary
//     index needed for reads.
//   - `count()` on the `by-session` index gives us the next `seq` cheaply
//     (no full scan) without persisting a counter row. For the v0.1
//     throughput target (a few hundred chunks per session) this is fine;
//     a future optimization could cache `lastSeq` in memory but adds a
//     correctness hazard across multi-tab opens of the same session.
//
// Why no transactions across awaits?
//   - IDB transactions auto-close at the end of the current microtask
//     queue tick (the "task" boundary). Awaiting an unrelated promise
//     between two operations on the SAME transaction is undefined on
//     Chromium and outright broken on Safari (the spec was tightened
//     post-Firefox/Edge convergence; older patterns that relied on
//     "transactions stay open as long as you keep doing IDB" no longer
//     hold). Each public method opens its own transaction and only
//     awaits the wrapped Promise. We pay an extra `transaction()` call
//     per op; in exchange we get portability and predictable behavior.
//
// Why structured-clone-safe `bytes` (Uint8Array)?
//   - IDB stores values via structured clone. `Uint8Array` is on the
//     supported list; `ArrayBuffer` would also work, but `Uint8Array`
//     is what `compress()` returns, so we avoid a useless view shuffle.

import type { SessionChunk, SessionStore, SessionStoreOptions } from './types.js';

const DEFAULT_DB_NAME = '@cubenest/rrweb-core';
const DEFAULT_STORE_NAME = 'session-chunks';
const SCHEMA_VERSION = 1;
const SESSION_INDEX = 'by-session';

/**
 * Internal stored row. Same fields as `SessionChunk` plus the `sessionId`
 * scope (which is implicit on the public type because each `SessionStore`
 * is already scoped to a session).
 */
interface StoredChunk {
  sessionId: string;
  seq: number;
  ts: number;
  bytes: Uint8Array;
  meta?: Record<string, string | number | boolean>;
}

/**
 * Promisify a single `IDBRequest`. Resolves on `success`, rejects on `error`.
 *
 * Keep the body tight — the listeners run on the IDB callback queue and
 * must NOT do work that could throw before binding both handlers, or the
 * UA will swallow the rejection and the caller's `await` will hang
 * forever. This is the standard `req<T>` pattern; we lift it into a
 * helper because every method below uses it ≥1 time.
 */
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    r.onsuccess = () => {
      resolve(r.result);
    };
    r.onerror = () => {
      reject(r.error ?? new Error('IDBRequest failed without an error object'));
    };
  });
}

/**
 * Promisify an `IDBTransaction` completion. Resolves on `complete`,
 * rejects on `error` / `abort`. Use after firing all writes so the
 * caller knows the transaction has actually committed before returning.
 */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('IDBTransaction failed without an error object'));
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('IDBTransaction aborted'));
    };
  });
}

/**
 * Open the database, creating the object store + index on first run.
 *
 * The `onupgradeneeded` path is the ONLY place schema mutations are
 * allowed. We pin to `SCHEMA_VERSION = 1` for v0.1; future schema
 * changes bump the version and add a migration branch here. Bumping
 * the version triggers a `versionchange` event on any other open
 * connection — callers in long-lived MV3 service workers should be
 * prepared to close-and-reopen.
 */
function openDb(idb: IDBFactory, dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(dbName, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        // Composite key `[sessionId, seq]` gives us natural range scans
        // by session without a secondary index for reads. The `by-session`
        // index is used for `count()`-based seq assignment and for
        // prune/clear cursors.
        const store = db.createObjectStore(storeName, { keyPath: ['sessionId', 'seq'] });
        store.createIndex(SESSION_INDEX, 'sessionId', { unique: false });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IDB open failed'));
    };
    request.onblocked = () => {
      // A previous connection with an older version is still open and
      // blocking our upgrade. We can't make progress; surface it as a
      // rejection rather than hanging forever.
      reject(new Error(`IDB open blocked by another open connection to ${dbName}`));
    };
  });
}

/**
 * Open an IDB-backed chunk store for a session.
 *
 * The returned `SessionStore` is scoped to `sessionId`; all read/write
 * operations are filtered by it. Multiple stores for different sessions
 * can be opened concurrently — they share the same DB connection's
 * keyspace but are isolated by the composite key.
 *
 * @param sessionId  non-empty session identifier; used as the first
 *                   component of every chunk's composite key
 * @param options    optional overrides (dbName, storeName, IDBFactory)
 * @throws {Error} if `sessionId` is empty / non-string, or if no
 *                 `IDBFactory` is available (`globalThis.indexedDB`
 *                 undefined and `options.indexedDB` not provided)
 */
export async function createSessionStore(
  sessionId: string,
  options?: SessionStoreOptions,
): Promise<SessionStore> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('createSessionStore: sessionId must be a non-empty string');
  }

  const dbName = options?.dbName ?? DEFAULT_DB_NAME;
  const storeName = options?.storeName ?? DEFAULT_STORE_NAME;

  // Resolve the IDBFactory. Explicit injection wins so tests / non-browser
  // environments can opt out of `globalThis.indexedDB`. The lookup
  // happens at construction time (not lazily per-op) so misconfiguration
  // fails fast with a clear error instead of a confusing "undefined is
  // not a function" deep inside an op.
  const idb: IDBFactory | undefined =
    options?.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) {
    throw new Error(
      'createSessionStore: no IDBFactory available — pass options.indexedDB or run in a browser',
    );
  }

  const db = await openDb(idb, dbName, storeName);

  // `closed` is the public-visible "is this store usable" flag. We flip
  // it to true on `close()` and check it at the top of every op. Doing
  // this in user-space (rather than relying on the IDB connection's
  // own closed state) lets us surface a clean, package-branded error
  // instead of whatever cryptic message the UA produces on a closed
  // connection (Chromium's "TransactionInactiveError" vs Safari's
  // various "InvalidStateError" wordings).
  let closed = false;

  function assertOpen(): void {
    if (closed) {
      throw new Error('SessionStore: connection is closed');
    }
  }

  async function append(bytes: Uint8Array, meta?: SessionChunk['meta']): Promise<number> {
    assertOpen();
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('SessionStore.append: bytes must be a Uint8Array');
    }
    // Step 1 — figure out the next `seq` by counting existing rows for
    // this session. We do this in a `readonly` transaction so it doesn't
    // contend with concurrent reads on other sessions; the cost is one
    // extra `transaction()` per append vs. doing the count + put in a
    // single `readwrite` (which would also work, but is harder to read
    // and gives no measurable benefit for our throughput).
    const countTx = db.transaction(storeName, 'readonly');
    const countStore = countTx.objectStore(storeName);
    const idx = countStore.index(SESSION_INDEX);
    const seq = await req(idx.count(IDBKeyRange.only(sessionId)));

    // Step 2 — write the row. Use `add()` (not `put()`) so a duplicate
    // composite key throws instead of silently overwriting; this guards
    // against the multi-tab race where two writers compute the same
    // `seq` concurrently. The caller can retry on the rejection.
    const writeTx = db.transaction(storeName, 'readwrite');
    const writeStore = writeTx.objectStore(storeName);
    const row: StoredChunk = {
      sessionId,
      seq,
      ts: Date.now(),
      bytes,
      ...(meta !== undefined ? { meta } : {}),
    };
    await req(writeStore.add(row));
    await txDone(writeTx);
    return seq;
  }

  async function read(fromSeq: number, toSeq?: number): Promise<SessionChunk[]> {
    assertOpen();
    if (!Number.isFinite(fromSeq) || fromSeq < 0) {
      throw new RangeError('SessionStore.read: fromSeq must be a non-negative number');
    }

    // Bound the range. When toSeq is omitted we want "everything ≥ fromSeq",
    // which we express as `[sessionId, fromSeq] .. [sessionId, +Infinity]`.
    // IDB compares composite keys lexicographically, so the upper bound
    // `[sessionId, +Infinity]` correctly stops before keys with a larger
    // sessionId. Note: `[sessionId, undefined]` does NOT work — undefined
    // is not a valid key component.
    const upper = toSeq ?? Number.POSITIVE_INFINITY;
    const range = IDBKeyRange.bound([sessionId, fromSeq], [sessionId, upper]);

    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const all = await req(store.getAll(range));

    // The cursor would already return rows in key order, but `getAll`
    // also returns them sorted by key. We assert the invariant anyway
    // — defensive, since downstream consumers depend on it.
    const chunks: SessionChunk[] = (all as StoredChunk[]).map((r) => ({
      seq: r.seq,
      ts: r.ts,
      bytes: r.bytes,
      ...(r.meta !== undefined ? { meta: r.meta } : {}),
    }));
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      if (prev && curr && prev.seq >= curr.seq) {
        // Should never happen given the composite-key sort, but if the
        // UA ever returns out-of-order rows we want a loud failure here
        // rather than a silently-corrupted replay.
        throw new Error(
          `SessionStore.read: rows out of order at index ${i} (${prev.seq} >= ${curr.seq})`,
        );
      }
    }
    return chunks;
  }

  async function readLastN(n: number): Promise<SessionChunk[]> {
    assertOpen();
    if (!Number.isFinite(n) || n < 0) {
      throw new RangeError('SessionStore.readLastN: n must be a non-negative number');
    }
    if (n === 0) return [];
    const total = await size();
    const fromSeq = Math.max(0, total - n);
    return read(fromSeq);
  }

  async function size(): Promise<number> {
    assertOpen();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const idx = store.index(SESSION_INDEX);
    return req(idx.count(IDBKeyRange.only(sessionId)));
  }

  async function totalBytes(): Promise<number> {
    assertOpen();
    // We walk the keyspace via `getAll` and sum byteLength. For v0.1
    // session sizes (a few hundred chunks at most), this is fine; if
    // future workloads need true streaming sums we'd switch to a
    // cursor and accumulate without materializing the rows.
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, Number.POSITIVE_INFINITY]);
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const all = (await req(store.getAll(range))) as StoredChunk[];
    let sum = 0;
    for (const row of all) {
      sum += row.bytes.byteLength;
    }
    return sum;
  }

  async function prune(beforeSeq: number): Promise<number> {
    assertOpen();
    if (!Number.isFinite(beforeSeq) && beforeSeq !== Number.POSITIVE_INFINITY) {
      throw new RangeError('SessionStore.prune: beforeSeq must be a finite number or +Infinity');
    }
    if (beforeSeq <= 0) return 0;

    // Range covers `[sessionId, 0] .. [sessionId, beforeSeq)` — open
    // upper bound excludes `beforeSeq` itself, matching the docstring
    // "delete chunks with seq < beforeSeq".
    const range = IDBKeyRange.bound([sessionId, 0], [sessionId, beforeSeq], false, true);
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);

    // Cursor-based delete is the IDB idiom for "delete range". We can't
    // use `delete(range)` here without losing the count of deleted
    // rows, and the count is part of the public return value.
    const deleted = await new Promise<number>((resolve, reject) => {
      const cursorReq = store.openCursor(range);
      let count = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve(count);
          return;
        }
        cursor.delete();
        count++;
        cursor.continue();
      };
      cursorReq.onerror = () => {
        reject(cursorReq.error ?? new Error('SessionStore.prune: cursor failed'));
      };
    });
    await txDone(tx);
    return deleted;
  }

  async function clear(): Promise<void> {
    assertOpen();
    // `prune(+Infinity)` deletes everything `seq < +Infinity` for this
    // session — i.e. every row scoped to `sessionId`. Other sessions'
    // rows are untouched because the range is bounded on the lower
    // side by `[sessionId, 0]` and on the upper by `[sessionId, ∞)`.
    await prune(Number.POSITIVE_INFINITY);
  }

  function close(): Promise<void> {
    if (closed) return Promise.resolve();
    closed = true;
    db.close();
    return Promise.resolve();
  }

  return {
    sessionId,
    append,
    read,
    readLastN,
    size,
    totalBytes,
    prune,
    clear,
    close,
  };
}
