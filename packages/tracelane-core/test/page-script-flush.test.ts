import { describe, expect, it, vi } from 'vitest';
import { tracelaneInitScript } from '../src/page-script';
import { DEFAULT_DRAIN_INTERVAL_MS } from '../src/recorder';

/**
 * Fix #2 (pre-navigation event rescue): the in-page `__tracelane__events` buffer
 * lives on `window` and dies on hard navigation before the Node poll drains it.
 * The init script now (a) merges any `sessionStorage['__tracelane__pending']`
 * stashed by the OLD document, and (b) registers a `pagehide` flush (once per
 * document) that stashes the live buffer into sessionStorage before teardown.
 *
 * These tests run `tracelaneInitScript` against a hand-built fake `window` (same
 * shim style as the other recorder tests) so we can drive sessionStorage and the
 * registered pagehide handler directly.
 */

interface FakeSessionStorage {
  store: Map<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  setItemSpy: ReturnType<typeof vi.fn>;
}

function makeSessionStorage(seed?: Record<string, string>): FakeSessionStorage {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  const setItemSpy = vi.fn((k: string, v: string) => {
    store.set(k, v);
  });
  return {
    store,
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: setItemSpy,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItemSpy,
  };
}

interface FakeWindow {
  rrweb: unknown;
  sessionStorage: FakeSessionStorage;
  listeners: Map<string, () => void>;
  addEventListener: (type: string, cb: () => void) => void;
  __tracelane__events?: unknown[];
  __tracelane__inited?: number;
  __tracelane__sessionId?: number;
  __tracelane__stop?: (() => void) | undefined;
  __tracelane__pagehideBound?: boolean;
}

function makeWindow(sessionStorage: FakeSessionStorage): FakeWindow {
  const listeners = new Map<string, () => void>();
  return {
    // Minimal rrweb stand-in: record returns a stop fn; the init script wires
    // emit into the buffer (not used by these tests, but kept realistic).
    rrweb: {
      record: (opts: { emit: (e: unknown) => void }) => {
        void opts;
        return () => {};
      },
      getRecordConsolePlugin: () => ({ name: 'console' }),
    },
    sessionStorage,
    listeners,
    addEventListener: (type: string, cb: () => void) => {
      listeners.set(type, cb);
    },
  };
}

/** Run the init script with the fake window installed as globalThis.window. */
function runInit(win: FakeWindow, now = 1_000_000): number {
  const prevWin = (globalThis as { window?: unknown }).window;
  const prevNow = Date.now;
  (globalThis as { window?: unknown }).window = win as unknown;
  Date.now = () => now;
  try {
    return tracelaneInitScript(250, { level: ['log'] });
  } finally {
    (globalThis as { window?: unknown }).window = prevWin;
    Date.now = prevNow;
  }
}

describe('page-script: pre-navigation rescue (merge-on-init)', () => {
  it('merges sessionStorage __tracelane__pending into the in-page buffer and clears the key', () => {
    const pending = [
      { type: 3, data: {}, timestamp: 1 },
      { type: 3, data: {}, timestamp: 2 },
    ];
    const ss = makeSessionStorage({ __tracelane__pending: JSON.stringify(pending) });
    const win = makeWindow(ss);

    runInit(win);

    // The two stashed events were merged into the fresh document's buffer.
    expect(win.__tracelane__events).toEqual(expect.arrayContaining(pending));
    expect((win.__tracelane__events as unknown[]).length).toBeGreaterThanOrEqual(2);
    // The key was consumed (so the next document doesn't double-merge).
    expect(ss.getItem('__tracelane__pending')).toBeNull();
  });

  it('is a no-op when there is no pending key', () => {
    const ss = makeSessionStorage();
    const win = makeWindow(ss);
    runInit(win);
    // Buffer initialized but empty (no rrweb events emitted in this stub).
    expect(win.__tracelane__events).toEqual([]);
  });

  it('tolerates a malformed pending value (parse failure is best-effort)', () => {
    const ss = makeSessionStorage({ __tracelane__pending: '{not json' });
    const win = makeWindow(ss);
    // Must not throw.
    expect(() => runInit(win)).not.toThrow();
    expect(win.__tracelane__events).toEqual([]);
  });

  it('ignores a pending value that is not a non-empty array', () => {
    const ss = makeSessionStorage({ __tracelane__pending: JSON.stringify([]) });
    const win = makeWindow(ss);
    runInit(win);
    expect(win.__tracelane__events).toEqual([]);
  });
});

describe('page-script: pre-navigation rescue (pagehide flush)', () => {
  it('registers a single pagehide handler that stashes the live buffer to sessionStorage', () => {
    const ss = makeSessionStorage();
    const win = makeWindow(ss);
    runInit(win);

    expect(win.__tracelane__pagehideBound).toBe(true);
    const handler = win.listeners.get('pagehide');
    expect(typeof handler).toBe('function');

    // Some events accumulate after the last drain.
    const buffered = [
      { type: 3, data: { source: 1 }, timestamp: 10 },
      { type: 3, data: { source: 2 }, timestamp: 11 },
    ];
    win.__tracelane__events = buffered;

    // Fire the handler the way the browser would on document teardown.
    (handler as () => void)();

    expect(ss.setItemSpy).toHaveBeenCalledTimes(1);
    expect(ss.setItemSpy).toHaveBeenCalledWith('__tracelane__pending', JSON.stringify(buffered));
    expect(ss.getItem('__tracelane__pending')).toBe(JSON.stringify(buffered));
  });

  it('does not re-bind the pagehide handler on a second same-document init', () => {
    const ss = makeSessionStorage();
    const win = makeWindow(ss);
    const addSpy = vi.spyOn(win, 'addEventListener');
    runInit(win, 1_000_000);
    // A second init on the SAME document (past cooldown so it actually runs).
    runInit(win, 1_000_500);
    const pagehideBinds = addSpy.mock.calls.filter((c) => c[0] === 'pagehide');
    expect(pagehideBinds).toHaveLength(1);
  });

  it('flush is a no-op when the buffer is empty (no setItem)', () => {
    const ss = makeSessionStorage();
    const win = makeWindow(ss);
    runInit(win);
    win.__tracelane__events = [];
    (win.listeners.get('pagehide') as () => void)();
    expect(ss.setItemSpy).not.toHaveBeenCalled();
  });

  it('size guard: an oversized buffer (> ~4MB serialized) is NOT written', () => {
    const ss = makeSessionStorage();
    const win = makeWindow(ss);
    runInit(win);

    // Build a buffer whose JSON serialization exceeds the ~4,000,000-char guard.
    const big = 'x'.repeat(4_100_000);
    win.__tracelane__events = [{ type: 3, data: { blob: big }, timestamp: 1 }];

    (win.listeners.get('pagehide') as () => void)();
    expect(ss.setItemSpy).not.toHaveBeenCalled();
    expect(ss.getItem('__tracelane__pending')).toBeNull();
  });

  it('flush tolerates a setItem that throws (private mode / quota)', () => {
    const ss = makeSessionStorage();
    ss.setItemSpy.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const win = makeWindow(ss);
    runInit(win);
    win.__tracelane__events = [{ type: 3, data: {}, timestamp: 1 }];
    expect(() => (win.listeners.get('pagehide') as () => void)()).not.toThrow();
  });
});

describe('recorder: drain interval default', () => {
  it('DEFAULT_DRAIN_INTERVAL_MS is 500 (shorter so pre-nav events drain before teardown)', () => {
    expect(DEFAULT_DRAIN_INTERVAL_MS).toBe(500);
  });
});
