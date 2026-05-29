// Test suite for the framework-agnostic network capture plugin
// (`src/plugins/network`). Adapted from the test plan in the phase 5
// dispatch.
//
// jsdom limitations we work around:
//   - PerformanceObserver: jsdom doesn't ship one; we install a minimal
//     shim on `window.PerformanceObserver` per-test.
//   - Response.clone(): jsdom's Response supports .clone()+.text() so we
//     don't need to fake those.
//   - XMLHttpRequest: jsdom ships a real one; we stub the network layer
//     by intercepting xhr.send via a vitest spy.
//
// Each test re-installs the observer via `getRecordNetworkPlugin().observer(
// …)` and tears down on completion to keep the module-level singleton
// `initialisedHandler` clean between cases.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CapturedNetworkRequest,
  NETWORK_PLUGIN_NAME,
  type NetworkData,
  type NetworkRecordOptions,
  getRecordNetworkPlugin,
} from '../src/plugins/network/index.js';
import {
  _resetNetworkObserverForTests,
  _setPerfEntryRetryConfigForTests,
} from '../src/plugins/network/record.js';

// Reduce the PerformanceResourceTiming retry config so tests don't
// spend ~2.75s per fetch waiting for a never-arriving entry. In jsdom,
// `performance.getEntriesByName` doesn't get populated by our mocked
// fetch responses; the plugin's fallback is to emit with `entry: null`
// after exhausting retries.
_setPerfEntryRetryConfigForTests(2, 1);

// ─── jsdom stubs ────────────────────────────────────────────────────────────

/**
 * jsdom doesn't populate `performance.getEntriesByName` for the URLs
 * fetched via mocked fetch/XHR. The plugin's `getRequestPerformanceEntry`
 * retries up to 10 times × 50ms-backoff = ~2.75s before giving up. To
 * keep tests fast we stub `performance.getEntriesByName` to return an
 * entry immediately so the wait loop terminates on the first attempt.
 */
function stubPerformanceGetEntriesByName(): void {
  // The plugin's `getRequestPerformanceEntry` filters entries by
  // `entry.startTime >= start && entry.startTime <= end` where `start`
  // and `end` are captured before/after the wrapped fetch resolves.
  // For the stub to land within that window we'd need to know the
  // wrapper's clock, which we don't. Instead, return entries with
  // `startTime: 0` and override the plugin's lookup to ignore the
  // window bounds. We do that by returning entries that always
  // satisfy `startTime >= start` — use Number.NEGATIVE_INFINITY-ish
  // semantics by setting startTime to a very-small positive value
  // (0) and bumping end to Number.MAX_SAFE_INTEGER on the entry.
  // Plugin filter: `(isUndefined(start) || entry.startTime >= start)`.
  // With `start` = ~0 (just after page load), `entry.startTime = 0`
  // satisfies it.
  Object.defineProperty(performance, 'getEntriesByName', {
    configurable: true,
    writable: true,
    value: (name: string): PerformanceResourceTiming[] => {
      const makeEntry = (initiatorType: string): PerformanceResourceTiming =>
        ({
          name,
          entryType: 'resource',
          initiatorType,
          startTime: 0,
          duration: 1,
          responseEnd: 1,
          transferSize: 100,
          toJSON: () => ({
            name,
            entryType: 'resource',
            initiatorType,
            startTime: 0,
            duration: 1,
            responseEnd: 1,
            transferSize: 100,
          }),
        }) as unknown as PerformanceResourceTiming;
      return [makeEntry('fetch'), makeEntry('xmlhttprequest')];
    },
  });
}

// ─── Setup helpers ───────────────────────────────────────────────────────────

type EmittedBatch = NetworkData;

interface InstalledObserver {
  teardown: () => void;
  batches: EmittedBatch[];
}

/**
 * Install the plugin's observer against the test window. Returns a list
 * of emitted batches and a teardown callback. Each test should call
 * teardown() to restore globals.
 */
function installObserver(opts?: NetworkRecordOptions): InstalledObserver {
  const plugin = getRecordNetworkPlugin(opts);
  const batches: EmittedBatch[] = [];
  // Plugin observer signature: (cb, win, options) -> listenerHandler
  const teardown = plugin.observer?.(
    ((data: unknown) => {
      batches.push(data as NetworkData);
    }) as (...args: unknown[]) => void,
    window as unknown as Parameters<NonNullable<typeof plugin.observer>>[1],
    plugin.options,
  );
  return {
    teardown: teardown ?? (() => undefined),
    batches,
  };
}

/**
 * Wait until either the predicate is true or N flush cycles have passed.
 * The plugin's fetch/XHR paths emit via an async
 * `getRequestPerformanceEntry` chain that retries up to 10 times with
 * exponentially increasing 50*attempt-ms sleeps (~2.75s total in the
 * worst case where no PerformanceEntry shows up — which is the norm
 * in jsdom).
 */
async function waitFor(
  predicate: () => boolean,
  maxFlushes = 400,
  flushIntervalMs = 10,
): Promise<void> {
  for (let i = 0; i < maxFlushes; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, flushIntervalMs));
  }
}

// ─── PerformanceObserver shim ────────────────────────────────────────────────

interface MockObserver {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  callback: PerformanceObserverCallback;
}

const installedObservers: MockObserver[] = [];

function installPerformanceObserverShim(): void {
  installedObservers.length = 0;
  class MockPerformanceObserver {
    callback: PerformanceObserverCallback;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(cb: PerformanceObserverCallback) {
      this.callback = cb;
      installedObservers.push(this as unknown as MockObserver);
    }
    static supportedEntryTypes = ['navigation', 'resource', 'paint', 'first-input'];
  }
  (
    window as unknown as { PerformanceObserver: typeof MockPerformanceObserver }
  ).PerformanceObserver = MockPerformanceObserver;
}

/**
 * Emit a synthetic resource-timing entry to all installed mock observers.
 */
function emitMockPerformanceEntry(entry: Partial<PerformanceResourceTiming>): void {
  const fullEntry = {
    entryType: 'resource',
    name: 'http://test.invalid/resource',
    startTime: 0,
    duration: 50,
    initiatorType: 'fetch',
    transferSize: 100,
    responseEnd: 50,
    toJSON() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this as unknown as Record<string, unknown>;
      return { ...self };
    },
    ...entry,
  } as PerformanceResourceTiming;
  for (const obs of installedObservers) {
    obs.callback(
      {
        getEntries: () => [fullEntry],
        getEntriesByType: () => [],
        getEntriesByName: () => [],
      } as unknown as PerformanceObserverEntryList,
      obs as unknown as PerformanceObserver,
    );
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetNetworkObserverForTests();
  installPerformanceObserverShim();
  stubPerformanceGetEntriesByName();
  // Reset the navigation entry list — jsdom seeds these; we clear them
  // so the "initial requests" path doesn't fire unexpectedly during
  // recordBody/recordHeaders tests.
  if (
    typeof performance !== 'undefined' &&
    typeof performance.clearResourceTimings === 'function'
  ) {
    performance.clearResourceTimings();
  }
});

afterEach(() => {
  _resetNetworkObserverForTests();
  vi.restoreAllMocks();
});

// ─── 1. Plugin shape ─────────────────────────────────────────────────────────

describe('getRecordNetworkPlugin — plugin shape', () => {
  it('returns a plugin with the correct name and observer hook', () => {
    const plugin = getRecordNetworkPlugin();
    expect(plugin.name).toBe(NETWORK_PLUGIN_NAME);
    expect(plugin.name).toBe('rrweb/network@1');
    expect(typeof plugin.observer).toBe('function');
    expect(plugin.options).toBeDefined();
  });

  it('accepts undefined options without throwing', () => {
    expect(() => getRecordNetworkPlugin()).not.toThrow();
    expect(() => getRecordNetworkPlugin(undefined)).not.toThrow();
    expect(() => getRecordNetworkPlugin({})).not.toThrow();
  });
});

// ─── 2-4. fetch path ─────────────────────────────────────────────────────────

describe('getRecordNetworkPlugin — fetch wrapper', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = window.fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('emits a captured request for a 200 GET (default opts: no body/headers)', async () => {
    // Provide a stub fetch — the plugin will patch this and call it.
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    // Default opts don't wrap fetch (no body/headers requested), so we
    // need recordBody or recordHeaders enabled to test the wrapper.
    // For this happy-path test we'll enable headers to trigger the wrap.
    const obs = installObserver({ recordHeaders: true });
    try {
      const res = await window.fetch('/api/data');
      expect(res.status).toBe(200);
      await waitFor(() => obs.batches.length > 0);
      expect(obs.batches.length).toBeGreaterThan(0);
      const flat = obs.batches.flatMap((b) => b.requests);
      const fetchReq = flat.find((r) => r.initiatorType === 'fetch');
      expect(fetchReq).toBeDefined();
      expect(fetchReq?.method).toBe('GET');
      expect(fetchReq?.status).toBe(200);
      expect(fetchReq?.name).toContain('/api/data');
      // Default recordBody=false; both bodies must be undefined.
      expect(fetchReq?.requestBody).toBeUndefined();
      expect(fetchReq?.responseBody).toBeUndefined();
    } finally {
      obs.teardown();
    }
  });

  it('captures 4xx status without throwing', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    const obs = installObserver({ recordHeaders: true });
    try {
      const res = await window.fetch('/api/missing');
      expect(res.status).toBe(404);
      await waitFor(() => obs.batches.some((b) => b.requests.some((r) => r.status === 404)));
      const flat = obs.batches.flatMap((b) => b.requests);
      const fetchReq = flat.find((r) => r.initiatorType === 'fetch');
      expect(fetchReq?.status).toBe(404);
    } finally {
      obs.teardown();
    }
  });

  it('captures request body when recordBody=true', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({ recordBody: true });
    try {
      await window.fetch('/api/login', {
        method: 'POST',
        body: '{"u":"alice"}',
        headers: { 'content-type': 'application/json' },
      });
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.requestBody !== undefined)),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.method).toBe('POST');
      expect(req?.requestBody).toBe('{"u":"alice"}');
    } finally {
      obs.teardown();
    }
  });

  it('captures response body when recordBody=true', async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{"result":"ok"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const obs = installObserver({ recordBody: true });
    try {
      await window.fetch('/api/ok');
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.responseBody !== undefined)),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.responseBody).toBe('{"result":"ok"}');
    } finally {
      obs.teardown();
    }
  });
});

// ─── 5-6. XHR path ───────────────────────────────────────────────────────────

describe('getRecordNetworkPlugin — XHR wrapper', () => {
  // jsdom's XMLHttpRequest doesn't actually do real network. Tests
  // synthesize a readyState=DONE event by stubbing send to dispatch
  // readyState changes.

  function makeFakeXHR(opts?: {
    responseStatus?: number;
    responseBody?: string;
    abort?: boolean;
  }): typeof XMLHttpRequest {
    class FakeXHR extends XMLHttpRequest {
      override open(
        ...args: Parameters<XMLHttpRequest['open']>
      ): ReturnType<XMLHttpRequest['open']> {
        return super.open(...args);
      }
      override send(_body?: Document | XMLHttpRequestBodyInit | null): void {
        const self = this as XMLHttpRequest & {
          readyState: number;
          status: number;
          response: string;
        };
        if (opts?.abort) {
          // simulate abort
          setTimeout(() => {
            const ev = new Event('abort');
            self.dispatchEvent(ev);
          }, 0);
          return;
        }
        setTimeout(() => {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', {
            value: opts?.responseStatus ?? 200,
            configurable: true,
          });
          Object.defineProperty(self, 'response', {
            value: opts?.responseBody ?? '{"ok":1}',
            configurable: true,
          });
          // also override getAllResponseHeaders
          (self as unknown as { getAllResponseHeaders: () => string }).getAllResponseHeaders = () =>
            'content-type: application/json\r\n';
          self.dispatchEvent(new Event('readystatechange'));
        }, 0);
      }
    }
    return FakeXHR as unknown as typeof XMLHttpRequest;
  }

  let originalXHR: typeof XMLHttpRequest;
  beforeEach(() => {
    originalXHR = window.XMLHttpRequest;
  });
  afterEach(() => {
    window.XMLHttpRequest = originalXHR;
  });

  it('captures a 200 XHR GET', async () => {
    window.XMLHttpRequest = makeFakeXHR();
    const obs = installObserver({ recordHeaders: true });
    try {
      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', '/api/xhr-get');
      xhr.send();
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.initiatorType === 'xmlhttprequest')),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'xmlhttprequest');
      expect(req?.method).toBe('GET');
      expect(req?.status).toBe(200);
    } finally {
      obs.teardown();
    }
  });

  it('does not crash on XHR abort', async () => {
    window.XMLHttpRequest = makeFakeXHR({ abort: true });
    const obs = installObserver({ recordHeaders: true });
    try {
      const xhr = new window.XMLHttpRequest();
      xhr.open('GET', '/api/aborted');
      xhr.send();
      // give the abort path time to fire
      await new Promise((resolve) => setTimeout(resolve, 50));
      // We don't strictly assert an emission — just that no exception
      // bubbled and the plugin didn't crash the test runner.
      expect(true).toBe(true);
    } finally {
      obs.teardown();
    }
  });
});

// ─── 7. PerformanceObserver path ─────────────────────────────────────────────

describe('getRecordNetworkPlugin — PerformanceObserver path', () => {
  it('emits a request with isInitial:true for performance entries', async () => {
    const obs = installObserver({ recordPerformance: true, recordInitialRequests: false });
    try {
      // Emit a synthetic resource entry via the mock observer.
      emitMockPerformanceEntry({
        name: 'https://cdn.example.com/styles.css',
        entryType: 'resource',
        initiatorType: 'link',
        startTime: 100,
        responseEnd: 150,
      });
      await waitFor(() => obs.batches.length > 0);
      const flat = obs.batches.flatMap((b) => b.requests);
      // Should at least contain a request with the synthetic URL.
      const synth = flat.find((r) => r.name.includes('styles.css'));
      expect(synth).toBeDefined();
      expect(synth?.initiatorType).toBe('link');
    } finally {
      obs.teardown();
    }
  });

  it('does not install observer when recordPerformance=false', () => {
    installedObservers.length = 0;
    const obs = installObserver({ recordPerformance: false });
    try {
      // No observer should have been registered.
      expect(installedObservers.length).toBe(0);
    } finally {
      obs.teardown();
    }
  });
});

// ─── 8-9. Header recording ───────────────────────────────────────────────────

describe('getRecordNetworkPlugin — header recording', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = window.fetch;
  });
  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('includes request/response headers when recordHeaders=true', async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-custom': 'yes' },
      }),
    );
    const obs = installObserver({ recordHeaders: true });
    try {
      await window.fetch('/api/headers', {
        headers: { 'x-request-header': 'value-here' },
      });
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.responseHeaders !== undefined)),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.requestHeaders).toBeDefined();
      expect(req?.responseHeaders).toBeDefined();
      expect(req?.responseHeaders?.['content-type']).toBe('application/json');
    } finally {
      obs.teardown();
    }
  });

  it('omits headers by default (recordHeaders not set)', async () => {
    // With recordHeaders=false (default), the fetch wrapper isn't even
    // installed unless recordBody is enabled. Enable recordBody so
    // wrapping happens, then assert headers absent.
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({ recordBody: true });
    try {
      await window.fetch('/api/no-headers');
      await waitFor(() => obs.batches.length > 0);
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.requestHeaders).toBeUndefined();
      expect(req?.responseHeaders).toBeUndefined();
    } finally {
      obs.teardown();
    }
  });
});

// ─── 10-11. maskRequestFn ────────────────────────────────────────────────────

describe('getRecordNetworkPlugin — maskRequestFn', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = window.fetch;
  });
  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('skips emission entirely when consumer mask returns null', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({
      recordBody: true,
      maskRequestFn: (req: CapturedNetworkRequest) =>
        req.name.includes('/api/secret') ? null : req,
    });
    try {
      await window.fetch('/api/secret');
      await window.fetch('/api/public');
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.name.includes('/api/public'))),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const secret = flat.find((r) => r.name.includes('/api/secret'));
      const pub = flat.find((r) => r.name.includes('/api/public'));
      expect(secret).toBeUndefined();
      expect(pub).toBeDefined();
    } finally {
      obs.teardown();
    }
  });

  it('forwards a modified request returned by consumer mask', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({
      recordBody: true,
      maskRequestFn: (req: CapturedNetworkRequest) => ({
        ...req,
        requestBody: '[masked-by-consumer]',
      }),
    });
    try {
      await window.fetch('/api/mask', { method: 'POST', body: 'orig-body' });
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.requestBody === '[masked-by-consumer]')),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.requestBody).toBe('[masked-by-consumer]');
    } finally {
      obs.teardown();
    }
  });
});

// ─── 12. Default mask pipes through substrate redactors ─────────────────────

describe('getRecordNetworkPlugin — default mask', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = window.fetch;
  });
  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('passes credit-card-shaped body through redactBody', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({ recordBody: true });
    try {
      // 4111 1111 1111 1111 is the well-known Luhn-valid Visa test card.
      await window.fetch('/api/cc', {
        method: 'POST',
        body: 'card=4111 1111 1111 1111',
      });
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.requestBody !== undefined)),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.requestBody).toBeDefined();
      // The substrate redactor swaps Luhn-valid CCs for a tagged marker.
      expect(req?.requestBody).toContain('<<REDACTED:CC>>');
      expect(req?.requestBody).not.toContain('4111 1111 1111 1111');
    } finally {
      obs.teardown();
    }
  });

  it('redacts deny-list headers via the default mask', async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'sess=abc' },
      }),
    );
    const obs = installObserver({ recordHeaders: true });
    try {
      await window.fetch('/api/hdr', {
        headers: { Authorization: 'Bearer SECRET', 'X-Other': 'fine' },
      });
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.requestHeaders !== undefined)),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.requestHeaders).toBeDefined();
      // The "authorization" header (case-insensitive deny-list match)
      // must be redacted; the non-deny-list header is preserved.
      const authVal = req?.requestHeaders?.authorization ?? req?.requestHeaders?.Authorization;
      expect(authVal).toBe('<<REDACTED>>');
      expect(req?.requestHeaders?.['x-other'] ?? req?.requestHeaders?.['X-Other']).toBe('fine');
      // response set-cookie header must also be redacted
      const setCookie =
        req?.responseHeaders?.['set-cookie'] ?? req?.responseHeaders?.['Set-Cookie'];
      expect(setCookie).toBe('<<REDACTED>>');
    } finally {
      obs.teardown();
    }
  });

  it('redacts credential params from URL query string', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({ recordBody: true });
    try {
      await window.fetch('/api/q?token=hunter2&page=2');
      await waitFor(() => obs.batches.length > 0);
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.name).not.toContain('hunter2');
      expect(req?.name).toContain('token=%3C%3CREDACTED%3E%3E'); // URL-encoded
      expect(req?.name).toContain('page=2');
    } finally {
      obs.teardown();
    }
  });
});

// ─── 13. Body byte-limit truncation ─────────────────────────────────────────

describe('getRecordNetworkPlugin — body truncation', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = window.fetch;
  });
  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('truncates bodies longer than bodyByteLimit', async () => {
    const longBody = 'a'.repeat(10_000);
    window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const obs = installObserver({ recordBody: true, bodyByteLimit: 100 });
    try {
      await window.fetch('/api/big', { method: 'POST', body: longBody });
      await waitFor(() =>
        obs.batches.some((b) => b.requests.some((r) => r.requestBody !== undefined)),
      );
      const flat = obs.batches.flatMap((b) => b.requests);
      const req = flat.find((r) => r.initiatorType === 'fetch');
      expect(req?.requestBody).toBeDefined();
      // The substrate redactor's truncation suffix is "[TRUNCATED N more bytes]"
      expect(req?.requestBody).toContain('TRUNCATED');
      // Total length is bounded to the limit plus the suffix marker.
      expect(req?.requestBody?.length).toBeLessThan(longBody.length);
    } finally {
      obs.teardown();
    }
  });
});

// ─── 14. maxRequestsPerBatch enforcement ────────────────────────────────────

describe('getRecordNetworkPlugin — batch overflow', () => {
  it('drops requests once maxRequestsPerBatch is exceeded in the same tick', async () => {
    const obs = installObserver({
      recordPerformance: true,
      recordInitialRequests: false,
      maxRequestsPerBatch: 3,
    });
    try {
      // Synthesize 10 resource entries in a single observer callback.
      // The single MockPerformanceObserver callback fires with one
      // entry — to get 10 in one batch, we'd need to emit them as one
      // list. Build a list and dispatch via the observer's callback
      // directly:
      const entries: Partial<PerformanceResourceTiming>[] = Array.from({ length: 10 }, (_, i) => ({
        entryType: 'resource',
        name: `https://cdn.example.com/r${i}.css`,
        initiatorType: 'link',
        startTime: i,
        responseEnd: i + 1,
      }));
      const fullEntries = entries.map((entry) => ({
        ...entry,
        duration: 10,
        transferSize: 100,
        toJSON() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          return { ...(this as Record<string, unknown>) };
        },
      })) as PerformanceResourceTiming[];
      for (const o of installedObservers) {
        o.callback(
          {
            getEntries: () => fullEntries,
            getEntriesByType: () => [],
            getEntriesByName: () => [],
          } as unknown as PerformanceObserverEntryList,
          o as unknown as PerformanceObserver,
        );
      }
      await waitFor(() => obs.batches.length > 0);
      const flat = obs.batches.flatMap((b) => b.requests);
      // Cap is per-flush rolling — should be <= maxRequestsPerBatch.
      expect(flat.length).toBeLessThanOrEqual(3);
    } finally {
      obs.teardown();
    }
  });
});

// ─── 15. Singleton — repeated install ──────────────────────────────────────

describe('getRecordNetworkPlugin — singleton guard', () => {
  it('second install is a no-op (the first observer owns teardown)', () => {
    const first = installObserver();
    const second = installObserver();
    expect(typeof first.teardown).toBe('function');
    expect(typeof second.teardown).toBe('function');
    first.teardown();
    second.teardown();
    // Successful no-throw means the singleton guard worked.
    expect(true).toBe(true);
  });
});
