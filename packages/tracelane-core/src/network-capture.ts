// CDP network capture wiring (Task 2.16 / P1 PRD §E.2).
//
// Enable the CDP Network domain and route failures into the page's
// `console.error` via `executor.execute`. Two failure classes are surfaced:
//
//   1. `Network.responseReceived` with `status >= 400` — a response arrived
//      but the server reported an HTTP error (4xx/5xx).
//   2. `Network.loadingFailed` — the request produced NO response at all
//      (CORS failure, DNS/connection failure, offline, abort). CDP's
//      `responseReceived` never fires for these, and the in-page status-0
//      wrapper is off by default, so without this branch a genuine failed
//      request would be invisible (audit A-6). We surface it with an explicit
//      status `000` (= a real 0 once parsed) so it reads as a true failure.
//
// The rrweb console plugin (installed by the recorder) then captures the
// console line, so failures show up in the report's network panel "for free" —
// no dedicated network transport in v1. Framework-agnostic: it talks only to a
// BrowserExecutor, so the WDIO and Playwright adapters share this one path.
//
// The console line is prefixed `[tracelane.net]` so @tracelane/report's network
// panel can scrape it back out (NETWORK_CONSOLE_PREFIX in panels.ts). The line
// ALWAYS carries a METHOD: panels.ts classifies a `status === 0` scrape row as
// a true failure only when a method is present (its "true error path" rule —
// see `isTrueErrorPath`), so a methodless `loadingFailed` line would be
// silently dropped from the panel.

import type { BrowserExecutor } from './browser-executor.js';

/** The fields of a CDP `Network.responseReceived` event we read (P1 PRD §E.1). */
interface ResponseReceivedEvent {
  requestId?: string;
  response?: {
    url?: string;
    status?: number;
    requestHeaders?: Record<string, string>;
  };
}

/**
 * The fields of a CDP `Network.requestWillBeSent` event we read. We track these
 * so a later `Network.loadingFailed` (which carries only a `requestId`) can be
 * correlated back to its method + URL.
 */
interface RequestWillBeSentEvent {
  requestId?: string;
  request?: {
    url?: string;
    method?: string;
  };
}

/** The fields of a CDP `Network.loadingFailed` event we read. */
interface LoadingFailedEvent {
  requestId?: string;
  errorText?: string;
  /** Present when the load was cancelled rather than failed; still a no-response. */
  canceled?: boolean;
}

/** Status sentinel for a request that produced no response (a true 0 once parsed). */
const NO_RESPONSE_STATUS = 0;

/**
 * Page-side logger. Self-contained (no Node closures) so it can be
 * `.toString()`-serialized by `execute` (PRD §A.4). The console plugin captures
 * this `console.error`; the `[tracelane.net]` prefix lets the report's network
 * panel scrape it back out (PRD §E.2).
 *
 * The status is zero-padded to 3 digits so it satisfies panels.ts's
 * `parseNetConsoleLine` regex (`(\d{3})`); `Number('000')` parses back to a
 * genuine `0`, which — paired with the always-present method — panels.ts treats
 * as a true network failure.
 */
function logNetworkErrorInPage(url: string, status: number, method: string): void {
  // Zero-pad to 3 digits without String.padStart so the .toString()-serialized
  // form runs on older in-page engines too.
  let code = String(status);
  while (code.length < 3) code = `0${code}`;
  console.error(`[tracelane.net] ${method} ${code} ${url}`);
}

/** Pull the request method out of CDP request headers, defaulting to GET. */
function methodOf(headers: Record<string, string> | undefined): string {
  if (!headers) return 'GET';
  // CDP exposes the pseudo-header `:method` for HTTP/2/3; fall back to a plain
  // `method` header, then GET.
  return headers[':method'] ?? headers.method ?? 'GET';
}

/**
 * Attach CDP network capture to a BrowserExecutor (P1 PRD §E.2).
 *
 * Enables the Network domain and registers subscribers that forward both HTTP
 * error responses (`Network.responseReceived`, `status >= 400`) and no-response
 * failures (`Network.loadingFailed` — CORS/DNS/offline/abort, audit A-6) into
 * `console.error`. Resolves once `Network.enable` has been sent. The
 * subscribers' own `execute` calls are fire-and-forget (their failures must not
 * break the test).
 *
 * To give the methodless `loadingFailed` events a method (required by panels.ts
 * to classify the row as failed), we keep a small `requestId → { method, url }`
 * map populated from `Network.requestWillBeSent`, and evict an entry once it has
 * either succeeded (`responseReceived`) or failed (`loadingFailed`) so the map
 * can't grow unbounded over a long session.
 */
export async function attachNetworkCapture(executor: BrowserExecutor): Promise<void> {
  await executor.cdp('Network', 'enable');

  // Correlation map: a `loadingFailed` carries only a requestId, so remember the
  // method + url from `requestWillBeSent` to reconstruct a method-bearing line.
  const inflight = new Map<string, { method: string; url: string }>();

  const emit = (url: string, status: number, method: string): void => {
    // Fire-and-forget: a logging failure (e.g. page mid-navigation) must not
    // surface as a test error.
    void executor
      .execute(logNetworkErrorInPage as (...args: unknown[]) => void, url, status, method)
      .catch(() => {
        /* page may be navigating; drop this one line */
      });
  };

  executor.on('Network.requestWillBeSent', (params: unknown) => {
    const e = params as RequestWillBeSentEvent;
    const id = e?.requestId;
    const url = e?.request?.url;
    if (typeof id !== 'string' || typeof url !== 'string') return;
    const method = typeof e.request?.method === 'string' ? e.request.method : 'GET';
    inflight.set(id, { method, url });
  });

  executor.on('Network.responseReceived', (params: unknown) => {
    const e = params as ResponseReceivedEvent;
    const response = e?.response;
    // A response arrived — this request will not surface via loadingFailed, so
    // drop it from the inflight map regardless of status.
    if (typeof e?.requestId === 'string') inflight.delete(e.requestId);
    const status = response?.status;
    if (typeof status !== 'number' || status < 400) return;
    const url = response?.url ?? '';
    const method = methodOf(response?.requestHeaders);
    emit(url, status, method);
  });

  executor.on('Network.loadingFailed', (params: unknown) => {
    const e = params as LoadingFailedEvent;
    const id = e?.requestId;
    // Correlate back to the request's method + url; CORS/DNS/offline/abort
    // failures produce NO response, so this is the only place they surface.
    const tracked = typeof id === 'string' ? inflight.get(id) : undefined;
    if (typeof id === 'string') inflight.delete(id);
    const url = tracked?.url ?? '';
    // Method is required for panels.ts to treat the status-0 row as a failure;
    // default to GET if the requestWillBeSent was missed (e.g. attach mid-flight).
    const method = tracked?.method ?? 'GET';
    emit(url, NO_RESPONSE_STATUS, method);
  });
}

// Exposed for unit tests: the page-side logger + method resolver are pure.
export const __internal = { logNetworkErrorInPage, methodOf };
