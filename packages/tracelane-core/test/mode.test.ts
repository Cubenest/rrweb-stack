import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';
import { DEFAULT_MODE, resolveMode } from '../src/mode';
import { createRecorder } from '../src/recorder';

function createFakeExecutor() {
  const win: Record<string, unknown> = {};
  win.eval = (code: string) => {
    // biome-ignore lint/security/noGlobalEval: test shim simulating page-context eval.
    eval(code);
  };
  const executor: BrowserExecutor = {
    execute: vi.fn(async <T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
      const prev = (globalThis as { window?: unknown }).window;
      (globalThis as { window?: unknown }).window = win;
      try {
        return fn(...args);
      } finally {
        (globalThis as { window?: unknown }).window = prev;
      }
    }),
    executeAsync: vi.fn(async <T>(): Promise<T> => undefined as T),
    cdp: vi.fn(async () => undefined),
    on: vi.fn(),
  };
  function pageEmit(...events: eventWithTime[]) {
    const buf = (win.__tracelane__events as eventWithTime[] | undefined) ?? [];
    buf.push(...events);
    win.__tracelane__events = buf;
  }
  return { executor, win, pageEmit };
}

const FAKE_BUNDLE =
  'window.rrweb = { record: function(o){ return function(){}; }, getRecordConsolePlugin: function(){ return {}; } };';

function fullSnapshot(ts: number): eventWithTime {
  return { type: EventType.FullSnapshot, data: {}, timestamp: ts } as unknown as eventWithTime;
}

describe('resolveMode (ADR-0005)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 'failed'", () => {
    expect(DEFAULT_MODE).toBe('failed');
    expect(resolveMode()).toBe('failed');
    expect(resolveMode(undefined)).toBe('failed');
  });

  it('honors an explicit config mode', () => {
    expect(resolveMode('all')).toBe('all');
    expect(resolveMode('failed')).toBe('failed');
  });

  it('TRACELANE_MODE env var overrides config', () => {
    vi.stubEnv('TRACELANE_MODE', 'all');
    expect(resolveMode('failed')).toBe('all');
    vi.stubEnv('TRACELANE_MODE', 'failed');
    expect(resolveMode('all')).toBe('failed');
  });

  it('ignores an invalid env value and falls back to config/default', () => {
    vi.stubEnv('TRACELANE_MODE', 'bogus');
    expect(resolveMode('all')).toBe('all');
    expect(resolveMode()).toBe('failed');
  });
});

describe('recorder.finalize: mode-driven keep/discard (ADR-0005)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mode 'failed' + passing test → discards the buffer, no report", async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE, mode: 'failed' });
    await recorder.start();
    pageEmit(fullSnapshot(1));

    const result = await recorder.finalize({ passed: true });
    expect(result.shouldBuildReport).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(recorder.getBuffer()).toHaveLength(0);
  });

  it("mode 'failed' + failing test → keeps the buffer and builds a report", async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE, mode: 'failed' });
    await recorder.start();
    pageEmit(fullSnapshot(1));

    const result = await recorder.finalize({ passed: false });
    expect(result.shouldBuildReport).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it("mode 'all' + passing test → still builds a report", async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE, mode: 'all' });
    await recorder.start();
    pageEmit(fullSnapshot(1));

    const result = await recorder.finalize({ passed: true });
    expect(result.shouldBuildReport).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it('TRACELANE_MODE=all overrides a config of failed on a passing test', async () => {
    vi.stubEnv('TRACELANE_MODE', 'all');
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE, mode: 'failed' });
    await recorder.start();
    pageEmit(fullSnapshot(1));

    const result = await recorder.finalize({ passed: true });
    expect(result.shouldBuildReport).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it('finalize drains any pending in-page events before deciding', async () => {
    const { executor, pageEmit } = createFakeExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: FAKE_BUNDLE, mode: 'all' });
    await recorder.start();
    // Events still sitting in the page buffer (not yet polled).
    pageEmit(fullSnapshot(1), fullSnapshot(2));

    const result = await recorder.finalize({ passed: false });
    expect(result.events).toHaveLength(2);
  });
});
