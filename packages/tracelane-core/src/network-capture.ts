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
  /** Resource type; `'Document'` marks the top-level (main) document load. */
  type?: string;
  response?: {
    url?: string;
    status?: number;
    requestHeaders?: Record<string, string>;
    /** Response headers (case-preserving). Note: omits `Set-Cookie`. */
    headers?: Record<string, string>;
  };
}

/**
 * The fields of a CDP `Network.requestWillBeSent` event we read. We track these
 * so a later `Network.loadingFailed` (which carries only a `requestId`) can be
 * correlated back to its method + URL.
 */
interface RequestWillBeSentEvent {
  requestId?: string;
  /** Resource type; `'Document'` marks the top-level (main) document request. */
  type?: string;
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

/**
 * Fields of a CDP `Network.responseReceivedExtraInfo` we read. This event (NOT
 * `responseReceived`) is where CDP exposes the raw `Set-Cookie` response header;
 * `responseReceived.response.headers` omits it. We read FLAG PRESENCE + cookie
 * NAME only — never the cookie value (privacy invariant, P1 security MVP).
 */
interface ResponseReceivedExtraInfoEvent {
  requestId?: string;
  headers?: Record<string, string>;
}

/** Options for {@link attachNetworkCapture}. */
export interface AttachNetworkCaptureOptions {
  /**
   * Capture privacy-safe MAIN-DOCUMENT response metadata (security-header
   * PRESENCE + cookie FLAGS only) on a `[tracelane.sec]` console line. Default
   * `true`; set `false` to fully disable — the `[tracelane.net]` behavior is
   * unaffected either way.
   */
  security?: boolean;
}

/**
 * The fixed allowlist of security-relevant response-header names whose PRESENCE
 * (never value) we surface. Lowercased; CDP header keys are case-preserving so
 * presence checks compare case-insensitively.
 */
const SEC_HEADER_ALLOWLIST = [
  'content-security-policy',
  'strict-transport-security',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
] as const;

/** A privacy-safe per-cookie record: NAME + flag presence booleans only. */
interface CookieFlags {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: boolean;
}

/** The privacy-safe main-document response metadata carried on `[tracelane.sec]`. */
interface ResponseMeta {
  url: string;
  status: number;
  isMainDocument: true;
  presentSecurityHeaders: string[];
  setCookies: CookieFlags[];
}

/**
 * Return the allowlisted security-header NAMES present in `headers` (lowercased).
 * Pure; never reads or returns any header VALUE.
 */
function presentSecurityHeaders(
  headers: Record<string, string> | undefined,
  allow: readonly string[],
): string[] {
  if (!headers) return [];
  const lower = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  return allow.filter((h) => lower.has(h));
}

/**
 * Parse a CDP `set-cookie` header into per-cookie FLAG PRESENCE records. CDP
 * joins multiple Set-Cookie headers with newlines. Captures only the cookie
 * NAME (left of the first `=`) and three flag booleans — NEVER the value.
 */
function parseSetCookies(setCookieHeader: string | undefined): CookieFlags[] {
  if (!setCookieHeader) return [];
  return setCookieHeader
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const name = (line.split('=', 1)[0] ?? '').trim();
      const low = line.toLowerCase();
      return {
        name,
        secure: /(?:^|;)\s*secure(?:\s*;|\s*$)/.test(low),
        httpOnly: /(?:^|;)\s*httponly(?:\s*;|\s*$)/.test(low),
        sameSite: /(?:^|;)\s*samesite\s*=/.test(low),
      };
    });
}

/**
 * Page-side logger for the `[tracelane.sec]` line. Self-contained (no Node
 * closures) so it can be `.toString()`-serialized by `execute` (PRD §A.4),
 * mirroring `logNetworkErrorInPage`. The console plugin captures this
 * `console.error`; the `[tracelane.sec]` prefix lets the report scrape it back
 * out. The payload is a pre-stringified JSON `ResponseMeta`.
 */
function logResponseMetaInPage(metaJson: string): void {
  console.error(`[tracelane.sec] ${metaJson}`);
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
export async function attachNetworkCapture(
  executor: BrowserExecutor,
  options: AttachNetworkCaptureOptions = {},
): Promise<void> {
  const security = options.security !== false;
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

  // --- Privacy-safe main-document security metadata ([tracelane.sec]) ---------
  // We track the top-level document's requestId, then assemble a ResponseMeta
  // from `responseReceived` (header presence) + `responseReceivedExtraInfo`
  // (cookie flags). Either may arrive first; we emit ONCE when we first have the
  // response part, and fold in extraInfo if it has already arrived (or wait for
  // it briefly via the microtask the fire-and-forget execute already implies).
  // To stay robust to ordering without blocking, we emit on whichever of the two
  // "completes" the main-doc picture: emit on `responseReceived`, but if
  // extraInfo arrived first we already stashed its cookies, and if extraInfo
  // arrives after we re-emit only if we had NOT already emitted. We guard with an
  // `emitted` flag so we never emit twice.
  let mainDocId: string | undefined;
  let mainDocMeta: ResponseMeta | undefined;
  let mainDocCookies: CookieFlags[] | undefined;
  let mainDocEmitted = false;

  const emitSec = (meta: ResponseMeta): void => {
    if (mainDocEmitted) return;
    mainDocEmitted = true;
    void executor
      .execute(logResponseMetaInPage as (...args: unknown[]) => void, JSON.stringify(meta))
      .catch(() => {
        /* page may be navigating; drop this one line */
      });
  };

  // Try to emit once we have the response part. Fold in cookies if extraInfo has
  // already landed; otherwise emit with whatever cookies we have (possibly []).
  // We only call this from `responseReceived`, so extraInfo arriving later (after
  // we've emitted) is a no-op — the guard prevents a double emit.
  const tryEmitSec = (): void => {
    if (!mainDocMeta) return;
    if (mainDocCookies) mainDocMeta.setCookies = mainDocCookies;
    emitSec(mainDocMeta);
  };

  executor.on('Network.requestWillBeSent', (params: unknown) => {
    const e = params as RequestWillBeSentEvent;
    const id = e?.requestId;
    const url = e?.request?.url;
    if (typeof id !== 'string' || typeof url !== 'string') return;
    const method = typeof e.request?.method === 'string' ? e.request.method : 'GET';
    inflight.set(id, { method, url });
    // Remember the top-level document's requestId so we can attach security meta
    // to its response. Only the first Document wins (the main navigation).
    if (security && e.type === 'Document' && mainDocId === undefined) {
      mainDocId = id;
    }
  });

  if (security) {
    executor.on('Network.responseReceivedExtraInfo', (params: unknown) => {
      const e = params as ResponseReceivedExtraInfoEvent;
      if (typeof e?.requestId !== 'string' || e.requestId !== mainDocId) return;
      // CDP exposes Set-Cookie here (header keys are typically lowercased in
      // extra-info), not on responseReceived.response.headers.
      const headers = e.headers ?? {};
      const setCookieKey = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie');
      const cookies = parseSetCookies(setCookieKey ? headers[setCookieKey] : undefined);
      mainDocCookies = cookies;
      // If the response part already arrived and emitted, this is a no-op (the
      // emit guard holds). If it arrived but we had no cookies yet, re-fold and
      // emit now. If the response part has NOT arrived yet, just stash; the
      // responseReceived handler will fold these in.
      if (mainDocMeta && !mainDocEmitted) tryEmitSec();
    });
  }

  executor.on('Network.responseReceived', (params: unknown) => {
    const e = params as ResponseReceivedEvent;
    const response = e?.response;
    const id = e?.requestId;
    // Grab the tracked entry BEFORE evicting it: `requestWillBeSent` recorded
    // the real method, whereas `response.requestHeaders` has no `:method`
    // pseudo-header over HTTP/1.1 (the common case for dev/CI servers) and would
    // otherwise fall back to GET — so a failed POST/PUT/DELETE would mislabel as
    // GET. A response arrived, so this request will not surface via
    // loadingFailed; drop it from the map regardless of status.
    const tracked = typeof id === 'string' ? inflight.get(id) : undefined;
    if (typeof id === 'string') inflight.delete(id);

    // Main-document security metadata. Per CDP, responseReceivedExtraInfo fires
    // BEFORE responseReceived, so any cookies have usually already been stashed;
    // we fold them in and emit ONCE here. If extraInfo never comes, we still emit
    // with `setCookies: []`. The emit guard prevents a double emit if a stray
    // extraInfo arrives afterwards.
    if (security && typeof id === 'string' && id === mainDocId && !mainDocEmitted) {
      const status = response?.status;
      const meta: ResponseMeta = {
        url: response?.url ?? '',
        status: typeof status === 'number' ? status : 0,
        isMainDocument: true,
        presentSecurityHeaders: presentSecurityHeaders(response?.headers, SEC_HEADER_ALLOWLIST),
        setCookies: mainDocCookies ?? [],
      };
      mainDocMeta = meta;
      tryEmitSec();
    }

    const status = response?.status;
    if (typeof status !== 'number' || status < 400) return;
    const url = response?.url ?? '';
    const method = tracked?.method ?? methodOf(response?.requestHeaders);
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

// Exposed for unit tests: the page-side loggers + pure resolvers/parsers.
export const __internal = {
  logNetworkErrorInPage,
  methodOf,
  logResponseMetaInPage,
  presentSecurityHeaders,
  parseSetCookies,
  SEC_HEADER_ALLOWLIST,
};
