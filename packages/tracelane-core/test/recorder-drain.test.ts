import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';
import { createRecorder } from '../src/recorder';

/**
 * A fake BrowserExecutor that simulates the page-side `window.__tracelane__events`
 * queue. `execute` runs the serialized fn against a stand-in `window` object so
 * we can exercise inject + drain without a real browser (ADR-0006).
 */
function createFakeExecutor() {
  const win: Record<string, unknown> = {};
  // The recorder injects the bundle via `window.eval(bundle)`. In a real page
  // that runs the source in global scope; here we run it while `globalThis.window`
  // is shimmed to `win`, so the bundle's `window.rrweb = ...` lands on `win`.
  win.eval = (code: string) => {
    // biome-ignore lint/security/noGlobalEval: test shim simulating page-context eval.
    eval(code);
  };
  // Minimal rrweb stand-in installed when the "bundle" runs. The bundle string
  // we feed the recorder defines window.rrweb for the init IIFE to find.
  const calls = { execute: 0, executeAsync: 0 };

  const executor: BrowserExecutor = {
    execute: vi.fn(async <T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
      calls.execute += 1;
      // Provide `window` to the serialized fn via globalThis shim.
      const prev = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = win;
      try {
        return fn(...args);
      } finally {
        (globalThis as { window?: unknown }).window = prev;
      }
    }),
    executeAsync: vi.fn(async <T>(): Promise<T> => {
      calls.executeAsync += 1;
      return undefined as T;
    }),
    cdp: vi.fn(async () => undefined),
    on: vi.fn(),
  };

  // Helper for tests to push fake events into the simulated page buffer.
  function pageEmit(...events: eventWithTime[]) {
    const buf = (win.__tracelane__events as eventWithTime[] | undefined) ?? [];
    buf.push(...events);
    win.__tracelane__events = buf;
  }

  return { executor, win, calls, pageEmit };
}

function fullSnapshot(ts: number): eventWithTime {
  return { type: EventType.FullSnapshot, data: {}, timestamp: ts } as unknown as eventWithTime;
}

// A no-op "bundle" that defines window.rrweb with the surface the init IIFE uses.
const FAKE_BUNDLE = `
  window.rrweb = {
    record: function (opts) { window.__tl_emit = opts.emit; return function stop(){}; },
    getRecordConsolePlugin: function () { return { name: 'console' }; },
  };
  if (window.rrweb.record.addCustomEvent === undefined) {
    window.rrweb.record.addCustomEvent = function (tag, payload) {
      (window.__tracelane__events = window.__tracelane__events || []).push({
        type: 5, data: { tag: tag, payload: payload }, timestamp: Date.now(),
      });
    };
  }
`;

describe('recorder: inject + drain (ADR-0006)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() injects the bundle and installs the in-page buffer', async () => {
    const { executor, win } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();
    expect(executor.execute).toHaveBeenCalled();
    expect(Array.isArray(win.__tracelane__events)).toBe(true);
    expect(win.rrweb).toBeDefined();
  });

  it('drain() reads and clears window.__tracelane__events into the Node buffer', async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    pageEmit(fullSnapshot(1), fullSnapshot(2));
    const drained = await recorder.drain();

    expect(drained).toHaveLength(2);
    expect(recorder.getBuffer()).toHaveLength(2);
  });

  it('drain() clears the page buffer so the next drain does not double-count', async () => {
    const { executor, win, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    pageEmit(fullSnapshot(1));
    await recorder.drain();
    expect((win.__tracelane__events as eventWithTime[]).length).toBe(0);

    pageEmit(fullSnapshot(2));
    await recorder.drain();
    expect(recorder.getBuffer()).toHaveLength(2);
  });

  it('polls every drainIntervalMs and merges batches into the Node buffer', async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE, drainIntervalMs: 5000 });
    await recorder.start();

    pageEmit(fullSnapshot(1));
    await vi.advanceTimersByTimeAsync(5000);
    pageEmit(fullSnapshot(2));
    await vi.advanceTimersByTimeAsync(5000);

    expect(recorder.getBuffer()).toHaveLength(2);
  });

  it('defaults drainIntervalMs to 500 (shorter so pre-nav events drain before teardown)', async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    pageEmit(fullSnapshot(1));
    // Nothing yet at 499ms.
    await vi.advanceTimersByTimeAsync(499);
    expect(recorder.getBuffer()).toHaveLength(0);
    // Drained at 500ms.
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.getBuffer()).toHaveLength(1);
  });

  it('stop() halts the poll and performs a final drain', async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE });
    await recorder.start();

    pageEmit(fullSnapshot(1));
    await recorder.stop();
    expect(recorder.getBuffer()).toHaveLength(1);

    // After stop the poll must not fire again.
    pageEmit(fullSnapshot(2));
    await vi.advanceTimersByTimeAsync(10000);
    expect(recorder.getBuffer()).toHaveLength(1);
  });
});
