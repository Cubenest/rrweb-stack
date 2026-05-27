// chrome.webRequest network adapter — Task 1.7.
//
// Subscribes to the chrome.webRequest event family from the extension
// service worker. P2/peek owns the listener; we accept the event source as
// a parameter rather than reading `chrome.webRequest` off a global so the
// substrate stays environment-agnostic.
//
// chrome.webRequest reports an HTTP exchange across multiple events:
//
//   - onBeforeRequest      — request URL + method + body (limited)
//   - onSendHeaders        — final request headers (after browser merging)
//   - onHeadersReceived    — response headers, status
//   - onCompleted          — terminal success: cache hint + size + final ts
//   - onErrorOccurred      — terminal failure: error string
//
// We correlate by `requestId` (chrome.webRequest's own monotonic id, scoped
// to a profile). Bodies are NOT accessible via chrome.webRequest in MV3 —
// the `requestBody` field is only populated by `onBeforeRequest` and only
// for form-encoded payloads, but our adapter doesn't depend on it: we
// surface what the transport gives us, and `responseBody` is always
// undefined here.

import { redactBody, redactNetworkHeaders } from '../masking/index.js';
import type { CapturedRequest, CapturedResponse, NetworkCaptureAdapter } from './types.js';

/**
 * The chrome.webRequest event family we depend on, narrowed to just the
 * `.addListener` / `.removeListener` shape. Each listener payload is
 * `any` at the wire level — the Chrome API documents the shapes per-event,
 * and the type-narrowing happens inside the adapter via small runtime
 * checks (`readString` / `readNumber` / `readHeaders`).
 *
 * We accept this shape (rather than `chrome.webRequest` directly) so the
 * substrate (a) typechecks outside an extension context, (b) is trivially
 * testable with hand-built fakes, and (c) gives the product the option of
 * wrapping the API with telemetry / permission checks.
 */
export interface WebRequestEvent {
  // biome-ignore lint/suspicious/noExplicitAny: chrome.webRequest payload shapes are documented per-event and we narrow at runtime.
  addListener(cb: (d: any) => void, filter?: unknown, extraInfoSpec?: string[]): void;
  // biome-ignore lint/suspicious/noExplicitAny: matches the addListener callback shape verbatim — chrome.* uses the same `any` here.
  removeListener(cb: (d: any) => void): void;
}

/**
 * Aggregate of the five chrome.webRequest events we subscribe to.
 *
 * The product-side wrapper typically exposes `chrome.webRequest` directly
 * (it already matches this shape), but tests inject hand-built fakes.
 */
export interface WebRequestEventSource {
  onBeforeRequest: WebRequestEvent;
  onSendHeaders: WebRequestEvent;
  onHeadersReceived: WebRequestEvent;
  onCompleted: WebRequestEvent;
  onErrorOccurred: WebRequestEvent;
}

/**
 * Factory-time options for `createWebRequestNetworkAdapter`.
 */
export interface WebRequestNetworkOptions {
  /**
   * chrome.webRequest URL/types filter, forwarded verbatim to each
   * `.addListener` call. Defaults to `{ urls: ['<all_urls>'] }` so the
   * adapter sees everything; products typically narrow this to reduce
   * load.
   */
  filter?: { urls: string[]; types?: string[] };
  /**
   * Body cap forwarded to `redactBody` for the (rare) cases where
   * `onBeforeRequest` exposes a textual request body. Defaults to 1 MB.
   */
  maxBodyBytes?: number;
  /**
   * `extraInfoSpec` passed to `onSendHeaders.addListener` /
   * `onHeadersReceived.addListener`. chrome.webRequest requires
   * `['responseHeaders']` to surface response headers and
   * `['requestHeaders']` for the final request-header set. The adapter
   * sets sensible defaults; callers can override (for example, to add
   * `'extraHeaders'` when capturing CORS-restricted headers).
   */
  extraInfoSpec?: {
    onBeforeRequest?: string[];
    onSendHeaders?: string[];
    onHeadersReceived?: string[];
  };
}

// ────────────────────────────────────────────────────────────────────────────
// chrome.webRequest payload narrowing
// ────────────────────────────────────────────────────────────────────────────

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * chrome.webRequest serializes headers as `{ name, value }[]` (preserving
 * insertion order). We collapse to a plain record — the masking module
 * already handles case-insensitive matching, so the lossy collapse is
 * cheap and matches the CDP path's shape.
 */
function readHeaderArray(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as { name?: unknown; value?: unknown; binaryValue?: unknown };
    const name = readString(entry.name);
    if (name === undefined) continue;
    // chrome.webRequest may expose `binaryValue` for non-UTF-8 headers; we
    // ignore those (they're rare in practice — bodies/cookies aside).
    const headerValue = readString(entry.value);
    if (headerValue !== undefined) out[name] = headerValue;
  }
  return out;
}

/**
 * chrome.webRequest's `requestBody` field shape on `onBeforeRequest`:
 *   { formData?: Record<string, string[]>, raw?: { bytes: ArrayBuffer }[] }
 *
 * `formData` is the only field that's safely textual. We serialize it to a
 * stable querystring-like representation so the redactor has something to
 * scan; `raw` is left alone (binary).
 */
function readRequestBody(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const formData = (value as { formData?: unknown }).formData;
  if (formData === null || typeof formData !== 'object') return undefined;
  const parts: string[] = [];
  for (const [key, values] of Object.entries(formData as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue;
    for (const v of values) {
      if (typeof v === 'string') parts.push(`${key}=${v}`);
    }
  }
  return parts.length > 0 ? parts.join('&') : undefined;
}

// Internal correlation record. The adapter accumulates pieces across the
// chrome.webRequest event chain and emits a single `CapturedRequest` /
// `CapturedResponse` per id.
interface InFlight {
  startTs: number;
  request: CapturedRequest;
  /** Set true once we've seen onSendHeaders and re-emitted with final headers. */
  headersUpgraded: boolean;
  /** Captured at onHeadersReceived; finalized + emitted at onCompleted/onErrorOccurred. */
  pendingResponse?: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
  };
}

/**
 * Build a `NetworkCaptureAdapter` that consumes chrome.webRequest events.
 *
 * The adapter installs five listeners on `source`, all gated by
 * `options.filter` (defaulting to `{ urls: ['<all_urls>'] }`). On
 * `dispose()` every listener is removed and the in-flight map is cleared.
 *
 * @param source A `WebRequestEventSource` — typically the global
 *               `chrome.webRequest` itself.
 * @param options `{ filter?, maxBodyBytes?, extraInfoSpec? }`.
 */
export function createWebRequestNetworkAdapter(
  source: WebRequestEventSource,
  options: WebRequestNetworkOptions = {},
): NetworkCaptureAdapter {
  const filter = options.filter ?? { urls: ['<all_urls>'] };
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const extraInfo = options.extraInfoSpec ?? {};
  const onBeforeRequestExtra = extraInfo.onBeforeRequest ?? ['requestBody'];
  const onSendHeadersExtra = extraInfo.onSendHeaders ?? ['requestHeaders'];
  const onHeadersReceivedExtra = extraInfo.onHeadersReceived ?? ['responseHeaders'];

  const inFlight = new Map<string, InFlight>();
  const requestHandlers = new Set<(req: CapturedRequest) => void>();
  const responseHandlers = new Set<(res: CapturedResponse) => void>();
  const errorHandlers = new Set<(err: { id: string; ts: number; errorText: string }) => void>();

  const emitRequest = (req: CapturedRequest): void => {
    for (const h of requestHandlers) h(req);
  };
  const emitResponse = (res: CapturedResponse): void => {
    for (const h of responseHandlers) h(res);
  };
  const emitError = (err: { id: string; ts: number; errorText: string }): void => {
    for (const h of errorHandlers) h(err);
  };

  // ──────────────────────────────────────────────────────────────────────
  // onBeforeRequest — emit CapturedRequest with whatever we know now.
  //
  // chrome.webRequest's `timeStamp` is already in ms epoch.
  // ──────────────────────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: webRequest's per-event payload is documented separately.
  const beforeRequestListener = (details: any): void => {
    if (details === null || typeof details !== 'object') return;
    const requestId = readString(details.requestId);
    if (requestId === undefined) return;

    const startTs = readNumber(details.timeStamp) ?? Date.now();
    const requestBodyRaw = readRequestBody(details.requestBody);
    const requestBody =
      requestBodyRaw !== undefined
        ? redactBody(requestBodyRaw, { maxLengthBytes: maxBodyBytes })
        : undefined;

    const captured: CapturedRequest = {
      id: requestId,
      ts: startTs,
      url: readString(details.url) ?? '',
      method: readString(details.method) ?? 'GET',
      // onBeforeRequest doesn't carry headers — they arrive on onSendHeaders.
      // We start with an empty record; onSendHeaders upgrades the entry.
      headers: {},
      ...(requestBody !== undefined ? { requestBody } : {}),
      ...(readString(details.type) !== undefined
        ? { resourceType: readString(details.type) as string }
        : {}),
    };

    inFlight.set(requestId, {
      startTs,
      request: captured,
      headersUpgraded: false,
    });
    emitRequest(captured);
  };
  source.onBeforeRequest.addListener(beforeRequestListener, filter, onBeforeRequestExtra);

  // ──────────────────────────────────────────────────────────────────────
  // onSendHeaders — final request headers. We mutate the in-flight record
  // so a later request-emission won't lose them; we DO NOT re-emit the
  // request (consumers expect one onRequest event per exchange).
  // ──────────────────────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: webRequest's per-event payload is documented separately.
  const sendHeadersListener = (details: any): void => {
    if (details === null || typeof details !== 'object') return;
    const requestId = readString(details.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    if (entry === undefined) return;
    const headers = redactNetworkHeaders(readHeaderArray(details.requestHeaders));
    entry.request = { ...entry.request, headers };
    entry.headersUpgraded = true;
  };
  source.onSendHeaders.addListener(sendHeadersListener, filter, onSendHeadersExtra);

  // ──────────────────────────────────────────────────────────────────────
  // onHeadersReceived — record response status + headers; defer emission
  // until onCompleted (matches the CDP path, which also defers).
  // ──────────────────────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: webRequest's per-event payload is documented separately.
  const headersReceivedListener = (details: any): void => {
    if (details === null || typeof details !== 'object') return;
    const requestId = readString(details.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    if (entry === undefined) return;
    const headers = redactNetworkHeaders(readHeaderArray(details.responseHeaders));
    entry.pendingResponse = {
      status: readNumber(details.statusCode) ?? 0,
      ...(readString(details.statusLine) !== undefined
        ? { statusText: readString(details.statusLine) as string }
        : {}),
      headers,
    };
  };
  source.onHeadersReceived.addListener(headersReceivedListener, filter, onHeadersReceivedExtra);

  // ──────────────────────────────────────────────────────────────────────
  // onCompleted — terminal success. Emit CapturedResponse.
  // ──────────────────────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: webRequest's per-event payload is documented separately.
  const completedListener = (details: any): void => {
    if (details === null || typeof details !== 'object') return;
    const requestId = readString(details.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    if (entry === undefined) return;

    const ts = readNumber(details.timeStamp) ?? Date.now();
    const durationMs = Math.max(0, ts - entry.startTs);
    const encodedSize = readNumber(details.responseSize);
    const fromCache = details.fromCache === true;

    const pending = entry.pendingResponse ?? {
      status: readNumber(details.statusCode) ?? 0,
      headers: {},
    };

    const captured: CapturedResponse = {
      id: requestId,
      ts,
      status: pending.status,
      ...(pending.statusText !== undefined ? { statusText: pending.statusText } : {}),
      headers: pending.headers,
      fromCache,
      ...(encodedSize !== undefined ? { encodedSize } : {}),
      durationMs,
    };
    inFlight.delete(requestId);
    emitResponse(captured);
  };
  source.onCompleted.addListener(completedListener, filter);

  // ──────────────────────────────────────────────────────────────────────
  // onErrorOccurred — terminal failure. Emit CapturedResponse with
  // errorText AND a parallel onError event.
  // ──────────────────────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noExplicitAny: webRequest's per-event payload is documented separately.
  const errorOccurredListener = (details: any): void => {
    if (details === null || typeof details !== 'object') return;
    const requestId = readString(details.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    const ts = readNumber(details.timeStamp) ?? Date.now();
    const errorText = readString(details.error) ?? 'unknown';
    const durationMs = entry !== undefined ? Math.max(0, ts - entry.startTs) : undefined;
    const fromCache = details.fromCache === true;

    const pending = entry?.pendingResponse ?? { status: 0, headers: {} };

    const captured: CapturedResponse = {
      id: requestId,
      ts,
      status: pending.status,
      ...(pending.statusText !== undefined ? { statusText: pending.statusText } : {}),
      headers: pending.headers,
      fromCache,
      ...(durationMs !== undefined ? { durationMs } : {}),
      errorText,
    };
    inFlight.delete(requestId);
    emitResponse(captured);
    emitError({ id: requestId, ts, errorText });
  };
  source.onErrorOccurred.addListener(errorOccurredListener, filter);

  // ──────────────────────────────────────────────────────────────────────
  // Adapter surface
  // ──────────────────────────────────────────────────────────────────────
  return {
    onRequest(handler) {
      requestHandlers.add(handler);
      return () => requestHandlers.delete(handler);
    },
    onResponse(handler) {
      responseHandlers.add(handler);
      return () => responseHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    async dispose(): Promise<void> {
      source.onBeforeRequest.removeListener(beforeRequestListener);
      source.onSendHeaders.removeListener(sendHeadersListener);
      source.onHeadersReceived.removeListener(headersReceivedListener);
      source.onCompleted.removeListener(completedListener);
      source.onErrorOccurred.removeListener(errorOccurredListener);
      requestHandlers.clear();
      responseHandlers.clear();
      errorHandlers.clear();
      inFlight.clear();
    },
  };
}
