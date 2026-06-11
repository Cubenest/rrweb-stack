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
