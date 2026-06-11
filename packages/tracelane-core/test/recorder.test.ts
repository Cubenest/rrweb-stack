import { EventType } from '@cubenest/rrweb-core';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';
import { createRecorder } from '../src/recorder';

/**
 * Minimal stub executor for the Node-side `addCustomEvent` path: it never needs
 * to touch the page (addCustomEvent appends straight to the Node buffer), so
 * `execute` is a no-op spy.
 */
function createStubExecutor(): BrowserExecutor {
  return {
    execute: vi.fn(async () => undefined as never),
    executeAsync: vi.fn(async () => undefined as never),
    cdp: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}

describe('recorder: addCustomEvent (Node-side Custom event)', () => {
  it('appends a Custom event directly to the Node buffer (no page execute)', () => {
    const executor = createStubExecutor();
    const recorder = createRecorder({ executor, rrwebBundle: '' });

    recorder.addCustomEvent('demo', { a: 1 });

    const buffer = recorder.getBuffer();
    expect(buffer).toHaveLength(1);
    const ev = buffer[0];
    expect(ev?.type).toBe(EventType.Custom);
    expect(ev?.data).toEqual({ tag: 'demo', payload: { a: 1 } });
    expect(typeof ev?.timestamp).toBe('number');
    // addCustomEvent must not round-trip through the page.
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

/**
 * Executor whose `execute` throws `errMsg` for the first `failFirst` calls, then
 * resolves to `1` (a valid init sid, ignored by inject/nav). Lets us simulate a
 * page-evaluate racing a navigation.
 */
function flakyExecutor(failFirst: number, errMsg: string): BrowserExecutor {
  let calls = 0;
  return {
    execute: vi.fn(async () => {
      calls += 1;
      if (calls <= failFirst) throw new Error(errMsg);
      return 1 as never;
    }),
    executeAsync: vi.fn(async () => undefined as never),
    cdp: vi.fn(async () => undefined),
    on: vi.fn(),
  };
}

describe('recorder: navigation-race resilience', () => {
  it('reinject retries past a transient "execution context was destroyed" and recovers', async () => {
    const executor = flakyExecutor(
      1,
      'Execution context was destroyed, most likely because of a navigation',
    );
    const recorder = createRecorder({ executor, rrwebBundle: 'x' });
    await expect(recorder.reinject('https://app.test/')).resolves.toBe(true);
    // first inject attempt threw; the retry ran inject+init+nav → > 1 calls.
    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('reinject does NOT retry a real (non-navigation) error — it propagates immediately', async () => {
    const executor = flakyExecutor(1, 'TypeError: rrweb is not a function');
    const recorder = createRecorder({ executor, rrwebBundle: 'x' });
    await expect(recorder.reinject('https://app.test/')).rejects.toThrow('rrweb is not a function');
    expect((executor.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('reinject gives up after bounded attempts when the race never clears', async () => {
    const executor = flakyExecutor(Number.POSITIVE_INFINITY, 'frame was detached');
    const recorder = createRecorder({ executor, rrwebBundle: 'x' });
    await expect(recorder.reinject('https://app.test/')).rejects.toThrow(/frame was detached/);
  });

  it('drain skips a cycle (returns []) when a poll races a navigation instead of throwing', async () => {
    const executor = flakyExecutor(Number.POSITIVE_INFINITY, 'Execution context was destroyed');
    const recorder = createRecorder({ executor, rrwebBundle: 'x' });
    await expect(recorder.drain()).resolves.toEqual([]);
  });

  it('drain still surfaces a real error', async () => {
    const executor = flakyExecutor(Number.POSITIVE_INFINITY, 'boom: real drain failure');
    const recorder = createRecorder({ executor, rrwebBundle: 'x' });
    await expect(recorder.drain()).rejects.toThrow('boom: real drain failure');
  });
});
