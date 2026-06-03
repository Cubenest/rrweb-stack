import { EventType } from '@cubenest/rrweb-core';
import type { customEvent, eventWithTime } from '@cubenest/rrweb-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';
import { tracelaneNavScript } from '../src/page-script';
import { createRecorder } from '../src/recorder';

/**
 * Fake executor that models REAL document teardown: each hard navigation gets a
 * FRESH in-page `window`/state (so `__tracelane__sessionId` resets to 1, exactly
 * as a new document does). The Node side is monotonic; the in-page sessionId is
 * not — that mismatch is the root cause Fix #1 addresses.
 *
 * `newDocument()` swaps in a brand-new fake window (the events buffer it stashes
 * for assertions persists across documents so a drain after a nav can still see
 * the marker pushed onto the post-nav document's buffer).
 */
function createFakeExecutor(initialNow: number) {
  let win: Record<string, unknown> = makeWindow();
  let now = initialNow;

  function makeWindow(): Record<string, unknown> {
    const w: Record<string, unknown> = {};
    w.eval = (code: string) => {
      // biome-ignore lint/security/noGlobalEval: test shim simulating page-context eval.
      eval(code);
    };
    return w;
  }

  const executor: BrowserExecutor = {
    execute: vi.fn(async <T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
      const prevWin = (globalThis as { window?: unknown }).window;
      const prevNow = Date.now;
      (globalThis as { window?: unknown }).window = win;
      // Freeze Date.now so the cooldown comparison is deterministic.
      Date.now = () => now;
      try {
        return fn(...args);
      } finally {
        (globalThis as { window?: unknown }).window = prevWin;
        Date.now = prevNow;
      }
    }),
    executeAsync: vi.fn(async <T>(): Promise<T> => undefined as T),
    cdp: vi.fn(async () => undefined),
    on: vi.fn(),
  };

  return {
    executor,
    get win() {
      return win;
    },
    advanceClock: (ms: number) => {
      now += ms;
    },
    setClock: (t: number) => {
      now = t;
    },
    /** Simulate a hard navigation: a brand-new document with fresh in-page state. */
    newDocument: () => {
      win = makeWindow();
    },
  };
}

// Bundle whose rrweb.record.addCustomEvent appends a Custom event to the buffer.
const FAKE_BUNDLE = `
  window.rrweb = {
    record: Object.assign(
      function (opts) { window.__tl_emit = opts.emit; return function stop(){}; },
      {
        addCustomEvent: function (tag, payload) {
          (window.__tracelane__events = window.__tracelane__events || []).push({
            type: 5, data: { tag: tag, payload: payload }, timestamp: Date.now(),
          });
        },
      },
    ),
    getRecordConsolePlugin: function () { return { name: 'console' }; },
  };
`;

function navEvents(buffer: eventWithTime[]): Array<customEvent<{ url: string; ts: number }>> {
  return buffer.filter(
    (e): e is customEvent<{ url: string; ts: number }> & eventWithTime =>
      e.type === EventType.Custom && (e as customEvent).data.tag === 'tracelane.nav',
  );
}

/** Did the executor run the nav script (the `tracelane.nav` marker)? */
function navScriptCalls(executor: BrowserExecutor): unknown[][] {
  return (executor.execute as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) => c[0] === tracelaneNavScript,
  );
}

describe('recorder: navigation re-injection (ADR-0006)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a fresh-document reinject returns true AND emits the tracelane.nav marker', async () => {
    const fake = createFakeExecutor(1_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    // A hard navigation tears down the document: fresh in-page state (sessionId
    // resets to 1), and the clock advances well past the 250ms cooldown.
    fake.newDocument();
    fake.advanceClock(1000);
    const didReinit = await recorder.reinject('https://example.com/page-2');

    expect(didReinit).toBe(true);
    // The executor ran the nav script (the marker), exactly once.
    expect(navScriptCalls(fake.executor)).toHaveLength(1);

    const drained = await recorder.drain();
    const navs = navEvents(drained);
    expect(navs).toHaveLength(1);
    expect(navs[0]?.data.payload.url).toBe('https://example.com/page-2');
    expect(typeof navs[0]?.data.payload.ts).toBe('number');
  });

  it('post-first-nav, EVERY subsequent hard navigation still emits its marker', async () => {
    // Regression guard for bug #1: the in-page sessionId resets to 1 on each new
    // document, while Node was monotonic — so after the first nav, every hard
    // nav looked cooldown-suppressed. The in-page init is now the authority.
    const fake = createFakeExecutor(1_500_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    fake.newDocument();
    fake.advanceClock(1000);
    expect(await recorder.reinject('https://example.com/a')).toBe(true);

    fake.newDocument();
    fake.advanceClock(1000);
    expect(await recorder.reinject('https://example.com/b')).toBe(true);

    fake.newDocument();
    fake.advanceClock(1000);
    expect(await recorder.reinject('https://example.com/c')).toBe(true);

    expect(navScriptCalls(fake.executor)).toHaveLength(3);
  });

  it('a within-cooldown re-init (same document) returns false and emits NO nav marker', async () => {
    const fake = createFakeExecutor(2_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    // Hash-only / HMR: same document (no newDocument()), immediate re-init
    // (< 250ms) — the in-page cooldown returns the 0 sentinel.
    fake.advanceClock(100);
    const didReinit = await recorder.reinject('https://example.com/#section');

    expect(didReinit).toBe(false);
    expect(navScriptCalls(fake.executor)).toHaveLength(0);

    const drained = await recorder.drain();
    expect(navEvents(drained)).toHaveLength(0);
  });

  it('init returns 0 (suppressed) vs >=1 (a recording (re)started)', async () => {
    const fake = createFakeExecutor(3_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();
    // The fresh document from start(): a recording started, sessionId >= 1.
    expect(fake.win.__tracelane__sessionId).toBe(1);

    // Suppressed (within cooldown, same document): no fresh recording — and the
    // in-page sessionId is untouched.
    fake.advanceClock(100);
    expect(await recorder.reinject('https://example.com/#a')).toBe(false);
    expect(fake.win.__tracelane__sessionId).toBe(1);

    // Hard navigation (fresh document, past cooldown): a recording (re)started.
    fake.newDocument();
    fake.advanceClock(500);
    expect(await recorder.reinject('https://example.com/page-3')).toBe(true);
    // Fresh document => the in-page session id starts back at 1.
    expect(fake.win.__tracelane__sessionId).toBe(1);
  });

  it('multiple full navigations each append their own nav marker', async () => {
    const fake = createFakeExecutor(4_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    fake.newDocument();
    fake.advanceClock(1000);
    await recorder.reinject('https://example.com/a');
    // Drain the first document's buffer before it's torn down.
    const firstBatch = await recorder.drain();

    fake.newDocument();
    fake.advanceClock(1000);
    await recorder.reinject('https://example.com/b');
    const secondBatch = await recorder.drain();

    const navs = navEvents([...firstBatch, ...secondBatch]);
    expect(navs.map((n) => n.data.payload.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});
