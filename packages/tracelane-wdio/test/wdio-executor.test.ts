import { describe, expect, it, vi } from 'vitest';
import { type WdioBrowser, createWdioExecutor } from '../src/wdio-executor';

// The adapter is the single seam between WDIO's `browser` and @tracelane/core's
// BrowserExecutor (ADR-0004). These tests lock the call-shape mapping with a
// mocked `browser` object — no real WDIO session.

function mockBrowser(overrides: Partial<WdioBrowser> = {}): WdioBrowser {
  return {
    execute: vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args)),
    executeAsync: vi.fn(async () => undefined),
    cdp: vi.fn(async () => ({ ok: true })),
    on: vi.fn(() => undefined),
    ...overrides,
  };
}

describe('createWdioExecutor', () => {
  it('maps execute(fn, ...args) straight through to browser.execute', async () => {
    const browser = mockBrowser();
    const exec = createWdioExecutor(browser);
    const out = await exec.execute((a: unknown, b: unknown) => (a as number) + (b as number), 2, 3);
    expect(out).toBe(5);
    expect(browser.execute).toHaveBeenCalledWith(expect.any(Function), 2, 3);
  });

  it('maps executeAsync straight through to browser.executeAsync', async () => {
    const browser = mockBrowser();
    const exec = createWdioExecutor(browser);
    await exec.executeAsync(() => {}, 'arg');
    expect(browser.executeAsync).toHaveBeenCalledWith(expect.any(Function), 'arg');
  });

  it('forwards cdp(domain, command) with no params arg when params is omitted', async () => {
    const browser = mockBrowser();
    const exec = createWdioExecutor(browser);
    await exec.cdp('Network', 'enable');
    expect(browser.cdp).toHaveBeenCalledWith('Network', 'enable');
    // Confirm arity: no third (params) argument was passed.
    expect((browser.cdp as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);
  });

  it('forwards cdp params when provided', async () => {
    const browser = mockBrowser();
    const exec = createWdioExecutor(browser);
    await exec.cdp('Network', 'setExtraHTTPHeaders', { headers: { traceparent: 'x' } });
    expect(browser.cdp).toHaveBeenCalledWith('Network', 'setExtraHTTPHeaders', {
      headers: { traceparent: 'x' },
    });
  });

  it('rejects cdp with a helpful message when the session has no cdp command', async () => {
    // @wdio/devtools-service not registered -> browser.cdp is undefined.
    const browser = mockBrowser({ cdp: undefined });
    const exec = createWdioExecutor(browser);
    await expect(exec.cdp('Network', 'enable')).rejects.toThrow(/@wdio\/devtools-service/);
  });

  it('registers CDP event handlers via browser.on', () => {
    const browser = mockBrowser();
    const exec = createWdioExecutor(browser);
    const handler = vi.fn();
    exec.on('Network.responseReceived', handler);
    expect(browser.on).toHaveBeenCalledWith('Network.responseReceived', handler);
  });
});
