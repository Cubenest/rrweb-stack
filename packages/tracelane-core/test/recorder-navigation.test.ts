import { EventType } from '@cubenest/rrweb-core';
import type { customEvent, eventWithTime } from '@cubenest/rrweb-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';
import { createRecorder } from '../src/recorder';

/**
 * Fake executor with a simulated page whose `addCustomEvent` pushes into the
 * in-page buffer (so nav-boundary markers are observable after a drain).
 */
function createFakeExecutor(initialNow: number) {
  const win: Record<string, unknown> = {};
  let now = initialNow;
  win.eval = (code: string) => {
    // biome-ignore lint/security/noGlobalEval: test shim simulating page-context eval.
    eval(code);
  };

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
    win,
    advanceClock: (ms: number) => {
      now += ms;
    },
    setClock: (t: number) => {
      now = t;
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

describe('recorder: navigation re-injection (ADR-0006)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('full page navigation (past cooldown) re-inits and appends a tracelane.nav event', async () => {
    const fake = createFakeExecutor(1_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    // A real navigation happens well after the 250ms cooldown.
    fake.advanceClock(1000);
    await recorder.reinject('https://example.com/page-2');

    const drained = await recorder.drain();
    const navs = navEvents(drained);
    expect(navs).toHaveLength(1);
    expect(navs[0]?.data.payload.url).toBe('https://example.com/page-2');
    expect(typeof navs[0]?.data.payload.ts).toBe('number');
  });

  it('hash-only navigation within the cooldown does NOT double-init or emit nav', async () => {
    const fake = createFakeExecutor(2_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    // Immediate hash change (< 250ms) — should be suppressed by the cooldown.
    fake.advanceClock(100);
    await recorder.reinject('https://example.com/#section');

    const drained = await recorder.drain();
    expect(navEvents(drained)).toHaveLength(0);
  });

  it('re-init increments the in-page session id; suppressed re-init does not', async () => {
    const fake = createFakeExecutor(3_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();
    expect(fake.win.__tracelane__sessionId).toBe(1);

    // Suppressed (within cooldown): session id unchanged.
    fake.advanceClock(100);
    await recorder.reinject('https://example.com/#a');
    expect(fake.win.__tracelane__sessionId).toBe(1);

    // Real navigation (past cooldown): session id increments.
    fake.advanceClock(500);
    await recorder.reinject('https://example.com/page-3');
    expect(fake.win.__tracelane__sessionId).toBe(2);
  });

  it('multiple full navigations each append their own nav marker', async () => {
    const fake = createFakeExecutor(4_000_000);
    const recorder = createRecorder({ executor: fake.executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    fake.advanceClock(1000);
    await recorder.reinject('https://example.com/a');
    fake.advanceClock(1000);
    await recorder.reinject('https://example.com/b');

    const drained = await recorder.drain();
    const navs = navEvents(drained);
    expect(navs.map((n) => n.data.payload.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});
