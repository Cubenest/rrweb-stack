import type { BrowserExecutor } from '@tracelane/core';
import { describe, expect, it, vi } from 'vitest';
import { __internal, attachNetworkCapture } from '../src/network-capture';

// CDP network capture (Task 2.16 / P1 PRD §E.2). Verify: Network.enable is sent,
// a Network.responseReceived subscriber is registered, and only status >= 400
// responses are routed into console.error (prefixed [tracelane.net]).

function mockExecutor() {
  let handler: ((params: unknown) => void) | undefined;
  const execute = vi.fn(async () => undefined);
  const cdp = vi.fn(async () => undefined);
  const on = vi.fn((_event: string, h: (params: unknown) => void) => {
    handler = h;
  });
  const executor: BrowserExecutor = {
    execute: execute as unknown as BrowserExecutor['execute'],
    executeAsync: vi.fn(async () => undefined) as unknown as BrowserExecutor['executeAsync'],
    cdp: cdp as unknown as BrowserExecutor['cdp'],
    on,
  };
  return { executor, execute, cdp, on, fire: (p: unknown) => handler?.(p) };
}

describe('attachNetworkCapture', () => {
  it('enables the CDP Network domain and subscribes to responseReceived', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    expect(m.cdp).toHaveBeenCalledWith('Network', 'enable');
    expect(m.on).toHaveBeenCalledWith('Network.responseReceived', expect.any(Function));
  });

  it('routes a 500 response into console.error via execute', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire({
      response: { url: 'https://api.test/x', status: 500, requestHeaders: { ':method': 'POST' } },
    });
    // The page-side logger fn + its args (url, status, method) are passed to execute.
    expect(m.execute).toHaveBeenCalledWith(expect.any(Function), 'https://api.test/x', 500, 'POST');
  });

  it('routes a 404 response (boundary >= 400)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire({ response: { url: 'https://api.test/missing', status: 404 } });
    expect(m.execute).toHaveBeenCalledWith(
      expect.any(Function),
      'https://api.test/missing',
      404,
      'GET',
    );
  });

  it('ignores a 200 response (below the 400 threshold)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire({ response: { url: 'https://api.test/ok', status: 200 } });
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('ignores a 399 response (just below threshold)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire({ response: { url: 'https://api.test/redir', status: 399 } });
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('ignores a malformed event with no response/status', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire({});
    m.fire(undefined);
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('swallows an execute rejection so a logging failure never breaks the test', async () => {
    const m = mockExecutor();
    m.execute.mockRejectedValueOnce(new Error('page navigating'));
    await attachNetworkCapture(m.executor);
    // Must not throw synchronously and the rejection must be caught.
    expect(() => m.fire({ response: { url: 'u', status: 503 } })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('network-capture internals', () => {
  it('methodOf reads :method, falls back to method, then GET', () => {
    expect(__internal.methodOf({ ':method': 'PUT' })).toBe('PUT');
    expect(__internal.methodOf({ method: 'DELETE' })).toBe('DELETE');
    expect(__internal.methodOf({})).toBe('GET');
    expect(__internal.methodOf(undefined)).toBe('GET');
  });

  it('logNetworkErrorInPage writes a [tracelane.net]-prefixed console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __internal.logNetworkErrorInPage('https://api.test/x', 500, 'POST');
    expect(spy).toHaveBeenCalledWith('[tracelane.net] POST 500 https://api.test/x');
    spy.mockRestore();
  });
});
