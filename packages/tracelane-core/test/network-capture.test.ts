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

  it('uses the tracked requestWillBeSent method for a 5xx response (HTTP/1.1 has no :method header)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    // requestWillBeSent records the real method (POST) ...
    m.fire(
      { requestId: 'req-co', request: { url: 'https://shop.demo/api/checkout', method: 'POST' } },
      'Network.requestWillBeSent',
    );
    // ... and the response carries NO requestHeaders (the HTTP/1.1 case), so
    // methodOf() would fall back to GET. The tracked method must win, otherwise
    // a failed POST mislabels as GET in the network panel.
    m.fire({
      requestId: 'req-co',
      response: { url: 'https://shop.demo/api/checkout', status: 500 },
    });
    expect(m.execute).toHaveBeenCalledWith(
      expect.any(Function),
      'https://shop.demo/api/checkout',
      500,
      'POST',
    );
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

// Task 8 / P1 security MVP: a privacy-safe [tracelane.sec] line carrying
// MAIN-DOCUMENT response metadata — security-header PRESENCE + cookie FLAGS
// ONLY, never values. The emit pattern mirrors [tracelane.net]: a self-contained
// page-side logger passed to executor.execute, fire-and-forget.
describe('attachNetworkCapture — [tracelane.sec] response metadata', () => {
  // The sec emit is deferred to a microtask (so cookie flags from
  // responseReceivedExtraInfo are folded in regardless of CDP arrival order), so
  // tests must flush microtasks before inspecting the captured execute calls.
  const flushMicrotasks = (): Promise<void> =>
    new Promise<void>((r) => {
      queueMicrotask(r);
    });

  // Pull the single [tracelane.sec] emission out of the execute mock by running
  // each captured page-side logger and inspecting what it would console.error.
  function secEmissions(execute: ReturnType<typeof vi.fn>): string[] {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      const first = a[0];
      if (typeof first === 'string' && first.startsWith('[tracelane.sec]')) lines.push(first);
    });
    for (const call of execute.mock.calls) {
      const fn = call[0] as ((...args: unknown[]) => void) | undefined;
      if (typeof fn === 'function') fn(...call.slice(1));
    }
    spy.mockRestore();
    return lines;
  }

  function netEmissions(execute: ReturnType<typeof vi.fn>): string[] {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      const first = a[0];
      if (typeof first === 'string' && first.startsWith('[tracelane.net]')) lines.push(first);
    });
    for (const call of execute.mock.calls) {
      const fn = call[0] as ((...args: unknown[]) => void) | undefined;
      if (typeof fn === 'function') fn(...call.slice(1));
    }
    spy.mockRestore();
    return lines;
  }

  function parseSec(line: string): {
    url: string;
    status: number;
    isMainDocument: boolean;
    presentSecurityHeaders: string[];
    setCookies: { name: string; secure: boolean; httpOnly: boolean; sameSite: boolean }[];
  } {
    return JSON.parse(line.slice('[tracelane.sec] '.length));
  }

  it('emits exactly one privacy-safe [tracelane.sec] line for the main document', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);

    // Main-document request (CDP marks it type: 'Document').
    m.fire(
      {
        requestId: 'doc-1',
        type: 'Document',
        request: { url: 'https://shop.demo/', method: 'GET' },
      },
      'Network.requestWillBeSent',
    );
    // Per CDP, responseReceivedExtraInfo fires BEFORE responseReceived. Set-Cookie
    // carries a real value — the emitted line must NEVER contain it.
    m.fire(
      {
        requestId: 'doc-1',
        headers: { 'set-cookie': 'sid=secretvalue; HttpOnly' },
      },
      'Network.responseReceivedExtraInfo',
    );
    // Response with real-looking header VALUES for some allowlisted headers.
    m.fire(
      {
        requestId: 'doc-1',
        type: 'Document',
        response: {
          url: 'https://shop.demo/',
          status: 200,
          headers: {
            'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'",
            'X-Frame-Options': 'DENY',
            'Content-Type': 'text/html; charset=utf-8',
          },
        },
      },
      'Network.responseReceived',
    );

    await flushMicrotasks();
    const lines = secEmissions(m.execute);
    expect(lines).toHaveLength(1);

    const meta = parseSec(lines[0] as string);
    expect(meta.isMainDocument).toBe(true);
    expect(meta.url).toBe('https://shop.demo/');
    expect(meta.status).toBe(200);
    expect([...meta.presentSecurityHeaders].sort()).toEqual(
      ['content-security-policy', 'x-frame-options'].sort(),
    );
    expect(meta.setCookies).toEqual([
      { name: 'sid', secure: false, httpOnly: true, sameSite: false },
    ]);

    // PRIVACY INVARIANT: no header VALUE and no cookie VALUE may leak.
    const raw = lines[0] as string;
    expect(raw).not.toContain("default-src 'self'");
    expect(raw).not.toContain('unsafe-inline');
    expect(raw).not.toContain('DENY');
    expect(raw).not.toContain('secretvalue');
  });

  it('emits a [tracelane.sec] line on responseReceived even if extraInfo never arrives', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire(
      { requestId: 'doc-2', type: 'Document', request: { url: 'https://x.test/', method: 'GET' } },
      'Network.requestWillBeSent',
    );
    m.fire(
      {
        requestId: 'doc-2',
        type: 'Document',
        response: {
          url: 'https://x.test/',
          status: 200,
          headers: { 'Strict-Transport-Security': 'max-age=63072000' },
        },
      },
      'Network.responseReceived',
    );
    // No extraInfo ever arrives; the deferred microtask still emits, with [].
    await flushMicrotasks();
    const lines = secEmissions(m.execute);
    expect(lines).toHaveLength(1);
    const meta = parseSec(lines[0] as string);
    expect(meta.presentSecurityHeaders).toEqual(['strict-transport-security']);
    expect(meta.setCookies).toEqual([]);
    expect(lines[0]).not.toContain('63072000');
  });

  it('handles extraInfo arriving BEFORE responseReceived (emits once)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire(
      { requestId: 'doc-3', type: 'Document', request: { url: 'https://y.test/', method: 'GET' } },
      'Network.requestWillBeSent',
    );
    m.fire(
      { requestId: 'doc-3', headers: { 'set-cookie': 'a=1; Secure; SameSite=Lax' } },
      'Network.responseReceivedExtraInfo',
    );
    m.fire(
      {
        requestId: 'doc-3',
        type: 'Document',
        response: {
          url: 'https://y.test/',
          status: 200,
          headers: { 'Referrer-Policy': 'no-referrer' },
        },
      },
      'Network.responseReceived',
    );
    await flushMicrotasks();
    const lines = secEmissions(m.execute);
    expect(lines).toHaveLength(1);
    const meta = parseSec(lines[0] as string);
    expect(meta.presentSecurityHeaders).toEqual(['referrer-policy']);
    expect(meta.setCookies).toEqual([{ name: 'a', secure: true, httpOnly: false, sameSite: true }]);
  });

  // INVERTED CDP ORDER (responseReceived BEFORE responseReceivedExtraInfo). The
  // deferred-microtask emit must still fold in the cookie flags — proving the
  // insecure-cookie LEAD signal is NOT dropped when CDP delivers the events in
  // the less-common order. Emits exactly once.
  it('handles responseReceived arriving BEFORE extraInfo (cookies still captured)', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire(
      { requestId: 'doc-4', type: 'Document', request: { url: 'https://w.test/', method: 'GET' } },
      'Network.requestWillBeSent',
    );
    // responseReceived FIRST ...
    m.fire(
      {
        requestId: 'doc-4',
        type: 'Document',
        response: {
          url: 'https://w.test/',
          status: 200,
          headers: { 'X-Content-Type-Options': 'nosniff' },
        },
      },
      'Network.responseReceived',
    );
    // ... then extraInfo with the Set-Cookie (same task batch, before the
    // deferred microtask runs). The cookie value must NEVER leak.
    m.fire(
      { requestId: 'doc-4', headers: { 'set-cookie': 'token=leakme; SameSite=Strict' } },
      'Network.responseReceivedExtraInfo',
    );
    await flushMicrotasks();
    const lines = secEmissions(m.execute);
    expect(lines).toHaveLength(1);
    const meta = parseSec(lines[0] as string);
    expect(meta.presentSecurityHeaders).toEqual(['x-content-type-options']);
    // Cookie flags survived the inverted order (NOT empty) — insecure-cookie
    // signal preserved: token is neither Secure nor HttpOnly.
    expect(meta.setCookies).toEqual([
      { name: 'token', secure: false, httpOnly: false, sameSite: true },
    ]);
    expect(lines[0]).not.toContain('leakme');
  });

  it('does not emit a [tracelane.sec] line for a non-document (subresource) response', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor);
    m.fire(
      {
        requestId: 'img-1',
        type: 'Image',
        request: { url: 'https://shop.demo/logo.png', method: 'GET' },
      },
      'Network.requestWillBeSent',
    );
    m.fire(
      {
        requestId: 'img-1',
        type: 'Image',
        response: { url: 'https://shop.demo/logo.png', status: 200, headers: {} },
      },
      'Network.responseReceived',
    );
    await flushMicrotasks();
    expect(secEmissions(m.execute)).toHaveLength(0);
  });

  it('with security:false, NO [tracelane.sec] line is emitted but [tracelane.net] is unchanged', async () => {
    const m = mockExecutor();
    await attachNetworkCapture(m.executor, { security: false });
    // Main-document flow that WOULD emit a sec line if enabled.
    m.fire(
      { requestId: 'doc-x', type: 'Document', request: { url: 'https://z.test/', method: 'GET' } },
      'Network.requestWillBeSent',
    );
    m.fire(
      {
        requestId: 'doc-x',
        type: 'Document',
        response: { url: 'https://z.test/', status: 200, headers: { 'X-Frame-Options': 'DENY' } },
      },
      'Network.responseReceived',
    );
    m.fire(
      { requestId: 'doc-x', headers: { 'set-cookie': 'sid=secret; HttpOnly' } },
      'Network.responseReceivedExtraInfo',
    );
    await flushMicrotasks();
    expect(secEmissions(m.execute)).toHaveLength(0);

    // [tracelane.net] behavior unchanged: a 500 still routes a net line.
    m.fire({ response: { url: 'https://z.test/api', status: 500 } });
    const net = netEmissions(m.execute);
    expect(net).toHaveLength(1);
    expect(net[0]).toContain('[tracelane.net] GET 500 https://z.test/api');
  });
});

describe('network-capture internals', () => {
  it('presentSecurityHeaders returns lowercased allowlisted names present', () => {
    const present = __internal.presentSecurityHeaders(
      {
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
        'Content-Type': 'text/html',
      },
      __internal.SEC_HEADER_ALLOWLIST,
    );
    expect([...present].sort()).toEqual(['content-security-policy', 'x-frame-options'].sort());
    expect(__internal.presentSecurityHeaders(undefined, __internal.SEC_HEADER_ALLOWLIST)).toEqual(
      [],
    );
  });

  it('parseSetCookies extracts NAME + flag presence only, never values', () => {
    expect(__internal.parseSetCookies('sid=secretvalue; HttpOnly')).toEqual([
      { name: 'sid', secure: false, httpOnly: true, sameSite: false },
    ]);
    expect(__internal.parseSetCookies('a=1; Secure; HttpOnly; SameSite=Strict')).toEqual([
      { name: 'a', secure: true, httpOnly: true, sameSite: true },
    ]);
    // Multiple cookies joined with newlines (CDP form).
    expect(__internal.parseSetCookies('x=1; Secure\ny=2; HttpOnly')).toEqual([
      { name: 'x', secure: true, httpOnly: false, sameSite: false },
      { name: 'y', secure: false, httpOnly: true, sameSite: false },
    ]);
    expect(__internal.parseSetCookies(undefined)).toEqual([]);
    // No value leak.
    const out = JSON.stringify(__internal.parseSetCookies('token=abc.def.ghi; Secure'));
    expect(out).not.toContain('abc.def.ghi');
  });

  it('logResponseMetaInPage writes a [tracelane.sec]-prefixed console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __internal.logResponseMetaInPage('{"url":"u"}');
    expect(spy).toHaveBeenCalledWith('[tracelane.sec] {"url":"u"}');
    spy.mockRestore();
  });

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
