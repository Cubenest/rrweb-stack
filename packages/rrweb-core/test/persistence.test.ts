// @vitest-environment jsdom
//
// IndexedDB persistence helper — Task 1.10 test suite.
//
// Hermetic strategy:
//   - `fake-indexeddb/auto` patches `globalThis.indexedDB` and
//     `globalThis.IDBKeyRange` before any test runs. We DON'T pass an
//     `options.indexedDB` in most tests — covering the default-resolution
//     path (`globalThis.indexedDB`) gives us coverage of the production
//     code path.
//   - Each `describe` block uses a fresh, unique `sessionId` (UUID-ish)
//     so tests can't accidentally see each other's chunks. The store is
//     a singleton-per-DB-per-storeName under the hood; we vary
//     `dbName` between describe-blocks where stronger isolation is
//     desired (e.g. multi-session isolation test).
//   - The "close" behaviour test uses a fresh DB so the close doesn't
//     interfere with later tests.
//
// What we deliberately don't cover here:
//   - Multi-tab `versionchange` upgrade-blocked races. fake-indexeddb
//     can simulate them but they're orthogonal to the v0.1 contract.
//   - Quota-exceeded errors. The IDB spec doesn't pin behaviour and
//     fake-indexeddb's simulation is approximate. Production callers
//     handle this at a higher layer (chunk-rotation policy).

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createSessionStore } from '../src/persistence';
import type { SessionStore } from '../src/persistence';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Per-test unique session id. fake-indexeddb persists across `it`/`test`
 *  cases inside the same file, so a unique id keeps tests independent
 *  without requiring teardown between them. */
let nextSessionCounter = 0;
function freshSessionId(): string {
  nextSessionCounter++;
  return `session-${Date.now()}-${nextSessionCounter}`;
}

/** Per-test unique db name. Used by the multi-session-isolation test
 *  and the close-behaviour test, where we want a completely fresh
 *  IDB database to avoid bleeding state. */
let nextDbCounter = 0;
function freshDbName(): string {
  nextDbCounter++;
  return `@cubenest/rrweb-core/test/${Date.now()}/${nextDbCounter}`;
}

/** Build a Uint8Array of the given length, filled with a deterministic
 *  byte pattern so equality assertions remain meaningful. */
function buildBytes(length: number, fill = 0xab): Uint8Array {
  const u = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    u[i] = (fill + i) & 0xff;
  }
  return u;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Construction
// ────────────────────────────────────────────────────────────────────────────

describe('createSessionStore — construction', () => {
  test('returns a store handle bound to the requested sessionId', async () => {
    const sessionId = freshSessionId();
    const store = await createSessionStore(sessionId);
    expect(store.sessionId).toBe(sessionId);
    await store.close();
  });

  test('throws on empty sessionId', async () => {
    await expect(createSessionStore('')).rejects.toThrow(/non-empty string/);
  });

  test('throws when no IDBFactory is available and none is passed', async () => {
    // Snapshot + clear the global so we can prove the error path. Restore
    // it on `finally` so subsequent tests still see fake-indexeddb. We
    // assign `undefined` instead of `delete`-ing the slot — the
    // production guard is `if (!idb)`, so both forms exercise the same
    // branch but assignment dodges `lint/performance/noDelete`.
    const g = globalThis as { indexedDB?: IDBFactory };
    const saved = g.indexedDB;
    g.indexedDB = undefined;
    try {
      await expect(createSessionStore('x')).rejects.toThrow(/no IDBFactory available/);
    } finally {
      g.indexedDB = saved;
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Append + read round-trip
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — append + read', () => {
  let store: SessionStore;
  beforeEach(async () => {
    store = await createSessionStore(freshSessionId());
  });
  afterEach(async () => {
    await store.close();
  });

  test('append + read(0) round-trips three chunks in seq order', async () => {
    const a = buildBytes(8, 0x10);
    const b = buildBytes(16, 0x20);
    const c = buildBytes(24, 0x30);

    await store.append(a);
    await store.append(b);
    await store.append(c);

    const out = await store.read(0);
    expect(out).toHaveLength(3);
    expect(out[0]?.seq).toBe(0);
    expect(out[1]?.seq).toBe(1);
    expect(out[2]?.seq).toBe(2);
    // Bytes are persisted verbatim.
    expect(Array.from(out[0]?.bytes ?? [])).toEqual(Array.from(a));
    expect(Array.from(out[1]?.bytes ?? [])).toEqual(Array.from(b));
    expect(Array.from(out[2]?.bytes ?? [])).toEqual(Array.from(c));
  });

  test('append assigns monotonically increasing seq starting at 0', async () => {
    const first = await store.append(buildBytes(1));
    const second = await store.append(buildBytes(1));
    const third = await store.append(buildBytes(1));
    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(third).toBe(2);
  });

  test('append rejects non-Uint8Array bytes', async () => {
    await expect(store.append('not bytes' as unknown as Uint8Array)).rejects.toThrow(
      /must be a Uint8Array/,
    );
  });

  test('empty bytes are accepted and round-trip as empty', async () => {
    const seq = await store.append(new Uint8Array([]));
    expect(seq).toBe(0);
    const out = await store.read(0);
    expect(out).toHaveLength(1);
    expect(out[0]?.bytes.byteLength).toBe(0);
  });

  test('meta is preserved verbatim through append + read', async () => {
    const meta = { url: 'https://example.com/x', isFirst: true, viewportWidth: 1280 };
    await store.append(buildBytes(4), meta);
    const out = await store.read(0);
    expect(out[0]?.meta).toEqual(meta);
  });

  test('ts is populated and approximately wall-clock at append time', async () => {
    const before = Date.now();
    await store.append(buildBytes(1));
    const after = Date.now();
    const [chunk] = await store.read(0);
    expect(chunk?.ts).toBeGreaterThanOrEqual(before);
    expect(chunk?.ts).toBeLessThanOrEqual(after);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Range reads
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — read ranges', () => {
  let store: SessionStore;
  beforeEach(async () => {
    store = await createSessionStore(freshSessionId());
  });
  afterEach(async () => {
    await store.close();
  });

  test('read(fromSeq, toSeq) returns the inclusive range', async () => {
    for (let i = 0; i < 5; i++) await store.append(buildBytes(4, i));
    const out = await store.read(1, 3);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.seq)).toEqual([1, 2, 3]);
  });

  test('read past the end returns an empty array', async () => {
    for (let i = 0; i < 3; i++) await store.append(buildBytes(2));
    const out = await store.read(100);
    expect(out).toEqual([]);
  });

  test('read(0) with an empty store returns []', async () => {
    const out = await store.read(0);
    expect(out).toEqual([]);
  });

  test('read rejects negative fromSeq', async () => {
    await expect(store.read(-1)).rejects.toThrow(/non-negative/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. readLastN
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — readLastN', () => {
  let store: SessionStore;
  beforeEach(async () => {
    store = await createSessionStore(freshSessionId());
  });
  afterEach(async () => {
    await store.close();
  });

  test('readLastN(3) returns the last three seqs of a 10-chunk session', async () => {
    for (let i = 0; i < 10; i++) await store.append(buildBytes(2, i));
    const out = await store.readLastN(3);
    expect(out.map((c) => c.seq)).toEqual([7, 8, 9]);
  });

  test('readLastN(0) returns an empty array even with chunks present', async () => {
    await store.append(buildBytes(2));
    const out = await store.readLastN(0);
    expect(out).toEqual([]);
  });

  test('readLastN larger than size returns everything', async () => {
    await store.append(buildBytes(1));
    await store.append(buildBytes(1));
    const out = await store.readLastN(99);
    expect(out.map((c) => c.seq)).toEqual([0, 1]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. size + totalBytes
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — size and totalBytes', () => {
  let store: SessionStore;
  beforeEach(async () => {
    store = await createSessionStore(freshSessionId());
  });
  afterEach(async () => {
    await store.close();
  });

  test('size reflects appended chunk count', async () => {
    expect(await store.size()).toBe(0);
    for (let i = 0; i < 7; i++) await store.append(buildBytes(2));
    expect(await store.size()).toBe(7);
  });

  test('totalBytes sums byteLength across all chunks', async () => {
    await store.append(buildBytes(10));
    await store.append(buildBytes(20));
    await store.append(buildBytes(30));
    expect(await store.totalBytes()).toBe(60);
  });

  test('totalBytes on empty store is 0', async () => {
    expect(await store.totalBytes()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. prune
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — prune', () => {
  let store: SessionStore;
  beforeEach(async () => {
    store = await createSessionStore(freshSessionId());
  });
  afterEach(async () => {
    await store.close();
  });

  test('prune(3) deletes seqs 0..2 and returns 3', async () => {
    for (let i = 0; i < 5; i++) await store.append(buildBytes(2, i));
    const deleted = await store.prune(3);
    expect(deleted).toBe(3);
    expect(await store.size()).toBe(2);
    const remaining = await store.read(0);
    expect(remaining.map((c) => c.seq)).toEqual([3, 4]);
  });

  test('prune(0) is a no-op and returns 0', async () => {
    await store.append(buildBytes(2));
    const deleted = await store.prune(0);
    expect(deleted).toBe(0);
    expect(await store.size()).toBe(1);
  });

  test('prune beyond size deletes everything', async () => {
    await store.append(buildBytes(2));
    await store.append(buildBytes(2));
    const deleted = await store.prune(999);
    expect(deleted).toBe(2);
    expect(await store.size()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. clear
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — clear', () => {
  test('clear() deletes every chunk for this session', async () => {
    const store = await createSessionStore(freshSessionId());
    try {
      for (let i = 0; i < 4; i++) await store.append(buildBytes(2));
      await store.clear();
      expect(await store.size()).toBe(0);
      expect(await store.read(0)).toEqual([]);
    } finally {
      await store.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Multi-session isolation
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — multi-session isolation', () => {
  test('two sessions with the same db do not see each other', async () => {
    const db = freshDbName();
    const a = await createSessionStore('sess-A', { dbName: db });
    const b = await createSessionStore('sess-B', { dbName: db });
    try {
      await a.append(buildBytes(4, 0x01));
      await a.append(buildBytes(4, 0x02));
      await b.append(buildBytes(4, 0x03));

      expect(await a.size()).toBe(2);
      expect(await b.size()).toBe(1);

      const aChunks = await a.read(0);
      const bChunks = await b.read(0);
      expect(aChunks).toHaveLength(2);
      expect(bChunks).toHaveLength(1);
      // The first byte we used to fill each Uint8Array differs across
      // sessions — confirm we got the right one in each store.
      expect(aChunks[0]?.bytes[0]).toBe(0x01);
      expect(bChunks[0]?.bytes[0]).toBe(0x03);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('clearing one session does not affect another', async () => {
    const db = freshDbName();
    const a = await createSessionStore('sess-X', { dbName: db });
    const b = await createSessionStore('sess-Y', { dbName: db });
    try {
      await a.append(buildBytes(2));
      await a.append(buildBytes(2));
      await b.append(buildBytes(2));

      await a.clear();
      expect(await a.size()).toBe(0);
      expect(await b.size()).toBe(1);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 9. Re-open same session
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — re-open', () => {
  test('reopening the same session sees prior chunks and continues the seq', async () => {
    const db = freshDbName();
    const sid = 'sess-reopen';
    const first = await createSessionStore(sid, { dbName: db });
    await first.append(buildBytes(1));
    await first.append(buildBytes(1));
    await first.append(buildBytes(1));
    await first.close();

    const second = await createSessionStore(sid, { dbName: db });
    try {
      expect(await second.size()).toBe(3);
      const nextSeq = await second.append(buildBytes(1));
      expect(nextSeq).toBe(3);
    } finally {
      await second.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 10. close behaviour
// ────────────────────────────────────────────────────────────────────────────

describe('SessionStore — close', () => {
  test('subsequent ops reject after close', async () => {
    const store = await createSessionStore(freshSessionId(), { dbName: freshDbName() });
    await store.close();
    // Per the store's contract, every op throws a package-branded Error
    // after close. We accept any of the public ops here so we know the
    // guard is wired into all of them — not just append.
    await expect(store.append(buildBytes(1))).rejects.toThrow(/connection is closed/);
    await expect(store.read(0)).rejects.toThrow(/connection is closed/);
    await expect(store.readLastN(1)).rejects.toThrow(/connection is closed/);
    await expect(store.size()).rejects.toThrow(/connection is closed/);
    await expect(store.totalBytes()).rejects.toThrow(/connection is closed/);
    await expect(store.prune(1)).rejects.toThrow(/connection is closed/);
    await expect(store.clear()).rejects.toThrow(/connection is closed/);
  });

  test('close is idempotent', async () => {
    const store = await createSessionStore(freshSessionId(), { dbName: freshDbName() });
    await store.close();
    await expect(store.close()).resolves.toBeUndefined();
  });
});
