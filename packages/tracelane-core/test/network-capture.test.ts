import { describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor.js';
import { __internal, attachNetworkCapture } from '../src/network-capture';

// NOTE: the cross-package contract test (the `[tracelane.net]` line →
// @tracelane/report extractNetwork classification) lives in
// `packages/tracelane-report/test/network-capture-contract.test.ts`, NOT here.
// Keeping it out of core preserves the one-directional dependency edge
// (report → core); importing @tracelane/report from core would create a build
// cycle Turbo can't topo-order.

// CDP network capture (Task 2.16 / P1 PRD §E.2 + audit A-6). Verify: Network.enable
// is sent, the responseReceived + loadingFailed subscribers are registered, only
// status >= 400 responses are routed into console.error (prefixed [tracelane.net]),
// and a loadingFailed (no-response) failure surfaces a method-bearing status-0 line.

function mockExecutor() {
  // Route handlers by CDP event name so all of requestWillBeSent /
  // responseReceived / loadingFailed can be fired independently.
  const handlers = new Map<string, (params: unknown) => void>();
  const execute = vi.fn(async () => undefined);
  const cdp = vi.fn(async () => undefined);
  const on = vi.fn((event: string, h: (params: unknown) => void) => {
    handlers.set(event, h);
  });
  const executor: BrowserExecutor = {
    execute: execute as unknown as BrowserExecutor['execute'],
    executeAsync: vi.fn(async () => undefined) as unknown as BrowserExecutor['executeAsync'],
    cdp: cdp as unknown as BrowserExecutor['cdp'],
    on,
  };
  return {
    executor,
    execute,
    cdp,
    on,
    // `fire` defaults to responseReceived to preserve the existing call sites.
    fire: (p: unknown, event = 'Network.responseReceived') => handlers.get(event)?.(p),
  };
}

describe('attachNetworkCapture', () => {
  it('enables the CDP Network domain and subscribes to the failure events', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    expect(m.cdp).toHaveBeenCalledWith('Network', 'enable');
    expect(m.on).toHaveBeenCalledWith('Network.responseReceived', expect.any(Function));
    // audit A-6: no-response failures (CORS/DNS/offline/abort) only surface
    // through Network.loadingFailed, correlated via Network.requestWillBeSent.
    expect(m.on).toHaveBeenCalledWith('Network.loadingFailed', expect.any(Function));
    expect(m.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function));
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

  it('routes a 400 response (exact boundary, >= 400)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire({ response: { url: 'https://api.test/bad-request', status: 400 } });
    expect(m.execute).toHaveBeenCalledWith(
      expect.any(Function),
      'https://api.test/bad-request',
      400,
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

  // audit A-6: a no-response failure (CORS/DNS/offline/abort) never fires
  // responseReceived; it only fires loadingFailed (carrying just a requestId).
  it('surfaces a Network.loadingFailed as a method-bearing status-0 line', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    // Track the request so the failure can be correlated to its method + url.
    m.fire(
      { requestId: 'req-1', request: { url: 'https://api.test/blocked', method: 'POST' } },
      'Network.requestWillBeSent',
    );
    m.fire({ requestId: 'req-1', errorText: 'net::ERR_FAILED' }, 'Network.loadingFailed');
    // Status 0 (no response). The page-side logger zero-pads it to `000` so
    // panels.ts's `(\d{3})` regex matches; the method is preserved so panels.ts
    // classifies it as a true failure.
    expect(m.execute).toHaveBeenCalledWith(
      expect.any(Function),
      'https://api.test/blocked',
      0,
      'POST',
    );
  });

  it('loadingFailed without a tracked request still emits a status-0 line (method GET)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    // No requestWillBeSent first (e.g. CDP attached mid-flight).
    m.fire({ requestId: 'orphan', errorText: 'net::ERR_ABORTED' }, 'Network.loadingFailed');
    expect(m.execute).toHaveBeenCalledWith(expect.any(Function), '', 0, 'GET');
  });

  it('does not double-report a request that received a response then is evicted', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire(
      { requestId: 'req-2', request: { url: 'https://api.test/ok', method: 'GET' } },
      'Network.requestWillBeSent',
    );
    // A 200 arrives — below threshold, nothing logged, and the inflight entry
    // is evicted so a stray later loadingFailed for the same id has no method.
    m.fire({ requestId: 'req-2', response: { url: 'https://api.test/ok', status: 200 } });
    expect(m.execute).not.toHaveBeenCalled();
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

  it('zero-pads a status-0 (no-response) failure to 000 for the panel regex', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __internal.logNetworkErrorInPage('https://api.test/blocked', 0, 'POST');
    // panels.ts's parseNetConsoleLine requires exactly 3 status digits.
    expect(spy).toHaveBeenCalledWith('[tracelane.net] POST 000 https://api.test/blocked');
    spy.mockRestore();
  });
});
