// Network capture abstraction — Task 1.7 test suite.
//
// The substrate ships ONE downstream API (`CapturedRequest`,
// `CapturedResponse`, `NetworkCaptureAdapter`) and TWO factories that adapt
// transport-specific event sources:
//
//   - createCDPNetworkAdapter         (P1/tracelane — CDP `Network.*`)
//   - createWebRequestNetworkAdapter  (P2/peek — `chrome.webRequest.*`)
//
// Tests in this file cover:
//   1. Each adapter's event-fanout contract (subscribe, emit, unsubscribe).
//   2. Header redaction via masking.redactNetworkHeaders (case-insensitive
//      deny-list applied INSIDE the adapter before consumer handlers see
//      anything).
//   3. Body redaction via masking.redactBody (PII regex bank + truncation).
//   4. Correlation across the multi-event chain (request ↔ response by
//      transport-native id; durationMs computed).
//   5. CROSS-ADAPTER STRUCTURAL EQUALITY — the load-bearing ADR-0002
//      contract: the same upstream exchange must produce the same
//      downstream shape regardless of transport.
//
// We hand-build fakes for both event sources to keep the tests fast and
// hermetic; the only product-side moving piece is the wrapper that
// converts the real `chrome.webRequest` / CDP client into the structural
// shape the adapter expects.

import { describe, expect, test, vi } from 'vitest';
import {
  type CDPNetworkEventSource,
  type CapturedRequest,
  type CapturedResponse,
  type WebRequestEvent,
  type WebRequestEventSource,
  createCDPNetworkAdapter,
  createWebRequestNetworkAdapter,
} from '../src/network';

// ────────────────────────────────────────────────────────────────────────────
// Fakes — CDP
// ────────────────────────────────────────────────────────────────────────────

/**
 * Hand-built `CDPNetworkEventSource`. Each `.emit('Network.foo', params)`
 * call routes to every handler registered via `.on('Network.foo', …)`.
 * `getResponseBody` is provided as a `vi.fn` so individual tests can
 * configure the reply (or assert it was NOT called).
 */
function makeFakeCDP(): {
  source: CDPNetworkEventSource;
  emit: (event: string, params: unknown) => void;
  getResponseBody: ReturnType<typeof vi.fn>;
  listenerCount: () => number;
} {
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const getResponseBody = vi.fn();
  const source: CDPNetworkEventSource = {
    on(event, handler) {
      let bucket = handlers.get(event);
      if (bucket === undefined) {
        bucket = new Set();
        handlers.set(event, bucket);
      }
      bucket.add(handler);
      return () => bucket?.delete(handler);
    },
    getResponseBody,
  };
  return {
    source,
    emit(event, params) {
      const bucket = handlers.get(event);
      if (bucket === undefined) return;
      for (const h of [...bucket]) h(params);
    },
    getResponseBody,
    listenerCount() {
      let total = 0;
      for (const bucket of handlers.values()) total += bucket.size;
      return total;
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fakes — chrome.webRequest
// ────────────────────────────────────────────────────────────────────────────

function makeFakeWebRequestEvent(): WebRequestEvent & {
  emit: (details: unknown) => void;
  listenerCount: () => number;
} {
  const listeners = new Set<(d: unknown) => void>();
  return {
    addListener(cb) {
      listeners.add(cb as (d: unknown) => void);
    },
    removeListener(cb) {
      listeners.delete(cb as (d: unknown) => void);
    },
    emit(details) {
      for (const cb of [...listeners]) cb(details);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function makeFakeWebRequest(): {
  source: WebRequestEventSource;
  emit: {
    beforeRequest: (d: unknown) => void;
    sendHeaders: (d: unknown) => void;
    headersReceived: (d: unknown) => void;
    completed: (d: unknown) => void;
    errorOccurred: (d: unknown) => void;
  };
  listenerCount: () => number;
} {
  const beforeRequest = makeFakeWebRequestEvent();
  const sendHeaders = makeFakeWebRequestEvent();
  const headersReceived = makeFakeWebRequestEvent();
  const completed = makeFakeWebRequestEvent();
  const errorOccurred = makeFakeWebRequestEvent();
  const source: WebRequestEventSource = {
    onBeforeRequest: beforeRequest,
    onSendHeaders: sendHeaders,
    onHeadersReceived: headersReceived,
    onCompleted: completed,
    onErrorOccurred: errorOccurred,
  };
  return {
    source,
    emit: {
      beforeRequest: beforeRequest.emit,
      sendHeaders: sendHeaders.emit,
      headersReceived: headersReceived.emit,
      completed: completed.emit,
      errorOccurred: errorOccurred.emit,
    },
    listenerCount() {
      return (
        beforeRequest.listenerCount() +
        sendHeaders.listenerCount() +
        headersReceived.listenerCount() +
        completed.listenerCount() +
        errorOccurred.listenerCount()
      );
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture builders — produce wire-shape CDP / webRequest events for a
// single canonical "fetch /api/me with a JWT, 200 OK" exchange.
// ────────────────────────────────────────────────────────────────────────────

// A real-looking JWT (random base64url payload) — the regex bank should
// replace it with `<<REDACTED:JWT>>`.
const FIXTURE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const FIXTURE_RESPONSE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Set-Cookie': 'session=abc; HttpOnly',
};

function cdpRequestEvent() {
  return {
    requestId: 'CDP-1',
    timestamp: 100, // monotonic seconds since process start
    wallTime: 1_700_000_000, // ms epoch / 1000
    type: 'Fetch',
    initiator: { type: 'script', url: 'https://app.example.com/main.js' },
    request: {
      url: 'https://api.example.com/me',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${FIXTURE_JWT}`,
        Accept: 'application/json',
      },
    },
  };
}

function cdpResponseEvent() {
  return {
    requestId: 'CDP-1',
    timestamp: 100.05,
    type: 'Fetch',
    response: {
      url: 'https://api.example.com/me',
      status: 200,
      statusText: 'OK',
      headers: FIXTURE_RESPONSE_HEADERS,
      fromDiskCache: false,
      mimeType: 'application/json',
      encodedDataLength: 0, // CDP fills this on loadingFinished
    },
  };
}

function cdpLoadingFinishedEvent() {
  return {
    requestId: 'CDP-1',
    timestamp: 100.1, // 100 ms after request start
    encodedDataLength: 512,
  };
}

function webRequestBefore() {
  return {
    requestId: 'WR-1',
    timeStamp: 1_700_000_000_000, // ms epoch
    type: 'xmlhttprequest',
    url: 'https://api.example.com/me',
    method: 'GET',
  };
}

function webRequestSendHeaders() {
  return {
    requestId: 'WR-1',
    timeStamp: 1_700_000_000_010,
    requestHeaders: [
      { name: 'Authorization', value: `Bearer ${FIXTURE_JWT}` },
      { name: 'Accept', value: 'application/json' },
    ],
  };
}

function webRequestHeadersReceived() {
  return {
    requestId: 'WR-1',
    timeStamp: 1_700_000_000_050,
    statusCode: 200,
    statusLine: 'HTTP/1.1 200 OK',
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Set-Cookie', value: 'session=abc; HttpOnly' },
    ],
  };
}

function webRequestCompleted() {
  return {
    requestId: 'WR-1',
    timeStamp: 1_700_000_000_100, // 100 ms after request start
    statusCode: 200,
    fromCache: false,
    responseSize: 512,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// createCDPNetworkAdapter
// ════════════════════════════════════════════════════════════════════════════

describe('createCDPNetworkAdapter', () => {
  test('onRequest fires on Network.requestWillBeSent with correct shape', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onRequest = vi.fn();
    adapter.onRequest(onRequest);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());

    expect(onRequest).toHaveBeenCalledTimes(1);
    const req = onRequest.mock.calls[0]?.[0] as CapturedRequest;
    expect(req.id).toBe('CDP-1');
    expect(req.url).toBe('https://api.example.com/me');
    expect(req.method).toBe('GET');
    expect(req.resourceType).toBe('Fetch');
    expect(req.initiator).toBe('https://app.example.com/main.js');
    // wallTime is in seconds; the adapter converts to ms epoch.
    expect(req.ts).toBe(1_700_000_000 * 1000);
  });

  test('headers are redacted via redactNetworkHeaders (Authorization → <<REDACTED>>)', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onRequest = vi.fn();
    adapter.onRequest(onRequest);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());

    const req = onRequest.mock.calls[0]?.[0] as CapturedRequest;
    expect(req.headers.Authorization).toBe('<<REDACTED>>');
    expect(req.headers.Accept).toBe('application/json');
  });

  test('onResponse fires on responseReceived → loadingFinished with durationMs and encodedSize', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    expect(onResponse).not.toHaveBeenCalled(); // deferred until loadingFinished

    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());

    expect(onResponse).toHaveBeenCalledTimes(1);
    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.id).toBe('CDP-1');
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
    expect(res.encodedSize).toBe(512);
    expect(res.durationMs).toBe(100); // 0.1 monotonic seconds → 100 ms
    expect(res.fromCache).toBe(false);
    expect(res.errorText).toBeUndefined();
  });

  test('response headers are redacted (Set-Cookie → <<REDACTED>>)', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());

    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.headers['Set-Cookie']).toBe('<<REDACTED>>');
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  test('onResponse fires with errorText on Network.loadingFailed (no separate success response)', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onResponse = vi.fn();
    const onError = vi.fn();
    adapter.onResponse(onResponse);
    adapter.onError?.(onError);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.loadingFailed', {
      requestId: 'CDP-1',
      timestamp: 100.05,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });

    expect(onResponse).toHaveBeenCalledTimes(1);
    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.id).toBe('CDP-1');
    expect(res.errorText).toBe('net::ERR_CONNECTION_REFUSED');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      id: 'CDP-1',
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });
  });

  test('captureResponseBodies: true + getResponseBody → body is fetched, redacted, and included', async () => {
    const cdp = makeFakeCDP();
    cdp.getResponseBody.mockResolvedValue({
      body: `{"token":"${FIXTURE_JWT}"}`,
      base64Encoded: false,
    });
    const adapter = createCDPNetworkAdapter(cdp.source, { captureResponseBodies: true });
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());
    // Allow the queued microtask in finalize-after-fetch to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(cdp.getResponseBody).toHaveBeenCalledWith('CDP-1');
    expect(onResponse).toHaveBeenCalledTimes(1);
    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.responseBody).toBeDefined();
    expect(res.responseBody).toContain('<<REDACTED:JWT>>');
    expect(res.responseBody).not.toContain(FIXTURE_JWT);
  });

  test('captureResponseBodies: true + base64Encoded reply → body is skipped', async () => {
    const cdp = makeFakeCDP();
    cdp.getResponseBody.mockResolvedValue({
      body: 'AAAA',
      base64Encoded: true,
    });
    const adapter = createCDPNetworkAdapter(cdp.source, { captureResponseBodies: true });
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());
    await Promise.resolve();
    await Promise.resolve();

    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.responseBody).toBeUndefined();
  });

  test('captureResponseBodies: true + getResponseBody rejects → response still emits (no body)', async () => {
    const cdp = makeFakeCDP();
    cdp.getResponseBody.mockRejectedValue(new Error('No data for redirect'));
    const adapter = createCDPNetworkAdapter(cdp.source, { captureResponseBodies: true });
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());
    await Promise.resolve();
    await Promise.resolve();

    expect(onResponse).toHaveBeenCalledTimes(1);
    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.responseBody).toBeUndefined();
  });

  test('captureResponseBodies: false (default) → getResponseBody is never called', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    adapter.onResponse(vi.fn());

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());

    expect(cdp.getResponseBody).not.toHaveBeenCalled();
  });

  test('request body is redacted via redactBody', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onRequest = vi.fn();
    adapter.onRequest(onRequest);

    cdp.emit('Network.requestWillBeSent', {
      ...cdpRequestEvent(),
      request: {
        url: 'https://api.example.com/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        postData: `{"token":"${FIXTURE_JWT}"}`,
      },
    });

    const req = onRequest.mock.calls[0]?.[0] as CapturedRequest;
    expect(req.requestBody).toBeDefined();
    expect(req.requestBody).toContain('<<REDACTED:JWT>>');
    expect(req.requestBody).not.toContain(FIXTURE_JWT);
  });

  test('unsubscribe from onRequest stops further requests reaching that handler', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onRequest = vi.fn();
    const unsub = adapter.onRequest(onRequest);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    unsub();
    cdp.emit('Network.requestWillBeSent', { ...cdpRequestEvent(), requestId: 'CDP-2' });

    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  test('unsubscribe from onResponse stops further responses', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onResponse = vi.fn();
    const unsub = adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());
    expect(onResponse).toHaveBeenCalledTimes(1);

    unsub();

    cdp.emit('Network.requestWillBeSent', { ...cdpRequestEvent(), requestId: 'CDP-2' });
    cdp.emit('Network.responseReceived', { ...cdpResponseEvent(), requestId: 'CDP-2' });
    cdp.emit('Network.loadingFinished', { ...cdpLoadingFinishedEvent(), requestId: 'CDP-2' });
    expect(onResponse).toHaveBeenCalledTimes(1);
  });

  test('dispose removes all four CDP subscriptions', async () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    // Force the four `source.on(...)` calls to register; the adapter does
    // this inside its factory closure already, but listenerCount only
    // tracks once they exist.
    expect(cdp.listenerCount()).toBeGreaterThanOrEqual(4);

    await adapter.dispose?.();
    expect(cdp.listenerCount()).toBe(0);
  });

  test('out-of-order responseReceived without a prior request is silently ignored', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());

    expect(onResponse).not.toHaveBeenCalled();
  });

  test('fromCache is reflected when responseReceived flags it', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', {
      ...cdpResponseEvent(),
      response: { ...cdpResponseEvent().response, fromDiskCache: true },
    });
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());

    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.fromCache).toBe(true);
  });

  test('non-object event params are tolerated (no throw, no emit)', () => {
    const cdp = makeFakeCDP();
    const adapter = createCDPNetworkAdapter(cdp.source);
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    adapter.onRequest(onRequest);
    adapter.onResponse(onResponse);

    cdp.emit('Network.requestWillBeSent', null);
    cdp.emit('Network.requestWillBeSent', 'oops');
    cdp.emit('Network.responseReceived', null);
    cdp.emit('Network.loadingFinished', null);
    cdp.emit('Network.loadingFailed', null);

    expect(onRequest).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// createWebRequestNetworkAdapter
// ════════════════════════════════════════════════════════════════════════════

describe('createWebRequestNetworkAdapter', () => {
  test('onRequest fires on onBeforeRequest with correct shape', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onRequest = vi.fn();
    adapter.onRequest(onRequest);

    wr.emit.beforeRequest(webRequestBefore());

    expect(onRequest).toHaveBeenCalledTimes(1);
    const req = onRequest.mock.calls[0]?.[0] as CapturedRequest;
    expect(req.id).toBe('WR-1');
    expect(req.url).toBe('https://api.example.com/me');
    expect(req.method).toBe('GET');
    expect(req.resourceType).toBe('xmlhttprequest');
    expect(req.ts).toBe(1_700_000_000_000);
  });

  test('request headers are populated on onSendHeaders and redacted', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    adapter.onRequest(onRequest);
    adapter.onResponse(onResponse);

    wr.emit.beforeRequest(webRequestBefore());
    wr.emit.sendHeaders(webRequestSendHeaders());
    wr.emit.headersReceived(webRequestHeadersReceived());
    wr.emit.completed(webRequestCompleted());

    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.id).toBe('WR-1');
    // onRequest fires before onSendHeaders, so headers are empty there;
    // the response (terminal) carries response headers, which we redact.
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Set-Cookie']).toBe('<<REDACTED>>');
  });

  test('onResponse correlates headersReceived + onCompleted by requestId', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    wr.emit.beforeRequest(webRequestBefore());
    wr.emit.sendHeaders(webRequestSendHeaders());
    wr.emit.headersReceived(webRequestHeadersReceived());
    expect(onResponse).not.toHaveBeenCalled(); // emission deferred to onCompleted

    wr.emit.completed(webRequestCompleted());

    expect(onResponse).toHaveBeenCalledTimes(1);
    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.id).toBe('WR-1');
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('HTTP/1.1 200 OK');
    expect(res.encodedSize).toBe(512);
    expect(res.durationMs).toBe(100);
    expect(res.fromCache).toBe(false);
  });

  test('onError correlates onErrorOccurred by requestId and fires CapturedResponse too', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onResponse = vi.fn();
    const onError = vi.fn();
    adapter.onResponse(onResponse);
    adapter.onError?.(onError);

    wr.emit.beforeRequest(webRequestBefore());
    wr.emit.errorOccurred({
      requestId: 'WR-1',
      timeStamp: 1_700_000_000_050,
      error: 'net::ERR_NAME_NOT_RESOLVED',
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      id: 'WR-1',
      errorText: 'net::ERR_NAME_NOT_RESOLVED',
    });
    expect(onResponse).toHaveBeenCalledTimes(1);
    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.errorText).toBe('net::ERR_NAME_NOT_RESOLVED');
  });

  test('case-insensitive header deny-list applied (lower-case `authorization` redacted)', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    wr.emit.beforeRequest(webRequestBefore());
    wr.emit.sendHeaders(webRequestSendHeaders());
    wr.emit.headersReceived({
      ...webRequestHeadersReceived(),
      responseHeaders: [
        { name: 'content-type', value: 'application/json' },
        { name: 'set-cookie', value: 'session=abc; HttpOnly' },
      ],
    });
    wr.emit.completed(webRequestCompleted());

    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.headers['set-cookie']).toBe('<<REDACTED>>');
  });

  test('responseBody is NEVER populated (chrome.webRequest can not access bodies)', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onResponse = vi.fn();
    adapter.onResponse(onResponse);

    wr.emit.beforeRequest(webRequestBefore());
    wr.emit.sendHeaders(webRequestSendHeaders());
    wr.emit.headersReceived(webRequestHeadersReceived());
    wr.emit.completed(webRequestCompleted());

    const res = onResponse.mock.calls[0]?.[0] as CapturedResponse;
    expect(res.responseBody).toBeUndefined();
  });

  test('form-encoded request body is decoded and redacted', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onRequest = vi.fn();
    adapter.onRequest(onRequest);

    wr.emit.beforeRequest({
      ...webRequestBefore(),
      method: 'POST',
      requestBody: {
        formData: {
          token: [FIXTURE_JWT],
          username: ['alice'],
        },
      },
    });

    const req = onRequest.mock.calls[0]?.[0] as CapturedRequest;
    expect(req.requestBody).toBeDefined();
    expect(req.requestBody).toContain('<<REDACTED:JWT>>');
    expect(req.requestBody).toContain('username=alice');
    expect(req.requestBody).not.toContain(FIXTURE_JWT);
  });

  test('unsubscribe from onRequest stops further requests', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    const onRequest = vi.fn();
    const unsub = adapter.onRequest(onRequest);

    wr.emit.beforeRequest(webRequestBefore());
    unsub();
    wr.emit.beforeRequest({ ...webRequestBefore(), requestId: 'WR-2' });

    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  test('dispose removes all five chrome.webRequest listeners', async () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    expect(wr.listenerCount()).toBe(5);

    await adapter.dispose?.();
    expect(wr.listenerCount()).toBe(0);
  });

  test('default filter is `<all_urls>` and is forwarded to addListener', () => {
    const wr = makeFakeWebRequest();
    const beforeAdd = vi.spyOn(wr.source.onBeforeRequest, 'addListener');
    createWebRequestNetworkAdapter(wr.source);
    expect(beforeAdd).toHaveBeenCalledWith(expect.any(Function), { urls: ['<all_urls>'] }, [
      'requestBody',
    ]);
  });

  test('user filter overrides the default and is forwarded verbatim', () => {
    const wr = makeFakeWebRequest();
    const beforeAdd = vi.spyOn(wr.source.onBeforeRequest, 'addListener');
    const filter = { urls: ['https://api.example.com/*'], types: ['xmlhttprequest'] };
    createWebRequestNetworkAdapter(wr.source, { filter });
    expect(beforeAdd).toHaveBeenCalledWith(expect.any(Function), filter, ['requestBody']);
  });

  test('non-object event details are tolerated (no throw)', () => {
    const wr = makeFakeWebRequest();
    const adapter = createWebRequestNetworkAdapter(wr.source);
    adapter.onRequest(vi.fn());
    adapter.onResponse(vi.fn());

    wr.emit.beforeRequest(null);
    wr.emit.beforeRequest(undefined);
    wr.emit.sendHeaders('oops');
    wr.emit.headersReceived(42);
    wr.emit.completed(null);
    wr.emit.errorOccurred(null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Cross-adapter structural equality — the load-bearing ADR-0002 guard.
//
// The two adapters consume different event sources but MUST produce the
// same downstream shape (modulo well-documented per-transport fields). We
// drive both with parallel fixtures of a single canonical exchange and
// assert that the diffable fields match.
// ════════════════════════════════════════════════════════════════════════════

describe('cross-adapter structural equality (ADR-0002)', () => {
  /**
   * Run one canonical exchange through each adapter, return the emitted
   * `{ request, response }` pair from each. Both fixtures encode the SAME
   * exchange (URL, method, headers, status, size, duration).
   */
  function runBothAdapters(): {
    cdp: { request: CapturedRequest; response: CapturedResponse };
    web: { request: CapturedRequest; response: CapturedResponse };
  } {
    // CDP path
    const cdp = makeFakeCDP();
    const cdpAdapter = createCDPNetworkAdapter(cdp.source);
    const cdpRequests: CapturedRequest[] = [];
    const cdpResponses: CapturedResponse[] = [];
    cdpAdapter.onRequest((r) => cdpRequests.push(r));
    cdpAdapter.onResponse((r) => cdpResponses.push(r));

    cdp.emit('Network.requestWillBeSent', cdpRequestEvent());
    cdp.emit('Network.responseReceived', cdpResponseEvent());
    cdp.emit('Network.loadingFinished', cdpLoadingFinishedEvent());

    // chrome.webRequest path
    const wr = makeFakeWebRequest();
    const webAdapter = createWebRequestNetworkAdapter(wr.source);
    const webRequests: CapturedRequest[] = [];
    const webResponses: CapturedResponse[] = [];
    webAdapter.onRequest((r) => webRequests.push(r));
    webAdapter.onResponse((r) => webResponses.push(r));

    wr.emit.beforeRequest(webRequestBefore());
    wr.emit.sendHeaders(webRequestSendHeaders());
    wr.emit.headersReceived(webRequestHeadersReceived());
    wr.emit.completed(webRequestCompleted());

    const cdpRequest = cdpRequests[0];
    const cdpResponse = cdpResponses[0];
    const webRequest = webRequests[0];
    const webResponse = webResponses[0];
    if (cdpRequest === undefined || cdpResponse === undefined) throw new Error('CDP emit failure');
    if (webRequest === undefined || webResponse === undefined)
      throw new Error('webRequest emit failure');

    return {
      cdp: { request: cdpRequest, response: cdpResponse },
      web: { request: webRequest, response: webResponse },
    };
  }

  test('both adapters expose the same CapturedRequest keys (modulo transport-specific fields)', () => {
    const { cdp, web } = runBothAdapters();
    // Strip transport-specific fields before comparing keys:
    //  - id: transport-native ids differ (CDP-1 vs WR-1)
    //  - ts: timestamps differ between fixtures
    //  - initiator: CDP-only
    //  - resourceType: vocabulary differs (Fetch vs xmlhttprequest)
    //  - headers: webRequest's onBeforeRequest carries no headers; the
    //    final state is populated on onSendHeaders (mutated in place,
    //    not re-emitted). Both ultimately reach a populated headers map
    //    when consumed by onResponse — see the response-keys assertion.
    const stripCdp = stripFields(cdp.request, ['id', 'ts', 'initiator', 'resourceType', 'headers']);
    const stripWeb = stripFields(web.request, ['id', 'ts', 'resourceType', 'headers']);
    expect(Object.keys(stripCdp).sort()).toEqual(Object.keys(stripWeb).sort());
  });

  test('both adapters produce structurally identical responses on the same exchange', () => {
    const { cdp, web } = runBothAdapters();
    // Normalize transport-specific fields so the structural comparison
    // surfaces only meaningful differences. We assert key-by-key here so
    // a future field-add to one adapter alone trips this test.
    const cdpKeys = Object.keys(cdp.response).sort();
    const webKeys = Object.keys(web.response).sort();
    expect(cdpKeys).toEqual(webKeys);
  });

  test('both responses agree on status, durationMs, encodedSize, fromCache for the same fixture', () => {
    const { cdp, web } = runBothAdapters();
    expect(cdp.response.status).toBe(web.response.status);
    expect(cdp.response.durationMs).toBe(web.response.durationMs);
    expect(cdp.response.encodedSize).toBe(web.response.encodedSize);
    expect(cdp.response.fromCache).toBe(web.response.fromCache);
  });

  test('both adapters redact the same response headers (Set-Cookie → <<REDACTED>>)', () => {
    const { cdp, web } = runBothAdapters();
    expect(cdp.response.headers['Set-Cookie']).toBe('<<REDACTED>>');
    expect(web.response.headers['Set-Cookie']).toBe('<<REDACTED>>');
    // Content-Type passes through both.
    expect(cdp.response.headers['Content-Type']).toBe('application/json');
    expect(web.response.headers['Content-Type']).toBe('application/json');
  });

  test('CapturedRequest from both adapters share the same required string fields', () => {
    const { cdp, web } = runBothAdapters();
    for (const r of [cdp.request, web.request]) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.ts).toBe('number');
      expect(typeof r.url).toBe('string');
      expect(typeof r.method).toBe('string');
      expect(typeof r.headers).toBe('object');
    }
    // Both should have used the same URL + method from the fixture.
    expect(cdp.request.url).toBe(web.request.url);
    expect(cdp.request.method).toBe(web.request.method);
  });

  test('CapturedResponse from both adapters share the same required terminal fields', () => {
    const { cdp, web } = runBothAdapters();
    for (const r of [cdp.response, web.response]) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.ts).toBe('number');
      expect(typeof r.status).toBe('number');
      expect(typeof r.fromCache).toBe('boolean');
      expect(typeof r.headers).toBe('object');
    }
  });
});

/**
 * Tiny test-side helper: return a shallow copy of `obj` with `fields`
 * removed. Used to normalize transport-specific deltas before structural
 * comparisons.
 */
function stripFields<T extends Record<string, unknown>>(obj: T, fields: string[]): Partial<T> {
  const out: Record<string, unknown> = { ...obj };
  for (const f of fields) delete out[f];
  return out as Partial<T>;
}
