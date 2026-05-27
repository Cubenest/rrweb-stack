// CDP network adapter — Task 1.7.
//
// Subscribes to the four CDP `Network.*` events that together describe an
// HTTP exchange:
//
//   - Network.requestWillBeSent — emit `CapturedRequest`
//   - Network.responseReceived — record the response shape (we don't emit
//     yet, because CDP fires loadingFinished afterwards with the size +
//     final timestamp; deferring emission lets us populate `durationMs`
//     and `encodedSize` in one pass).
//   - Network.loadingFinished — finalize + emit `CapturedResponse`
//   - Network.loadingFailed — emit a `CapturedResponse` with `errorText`,
//     and (when registered) a parallel `onError` event.
//
// Why this adapter doesn't import a CDP client: same load-bearing reason as
// the screenshot adapter — the substrate has to be transport-agnostic, and
// every framework (WDIO/Playwright/Cypress) already owns a CDP session.
// We accept a `CDPNetworkEventSource` shape and call `.on(event, handler)`.
//
// Body fetching is opt-in. Real-environment cost: `Network.getResponseBody`
// keeps response bodies pinned in memory in the renderer until called,
// which is why CDP defaults to NOT retaining them. Products turn it on
// when they want the bodies and accept the memory tax.

import { redactBody, redactNetworkHeaders } from '../masking/index.js';
import type { CapturedRequest, CapturedResponse, NetworkCaptureAdapter } from './types.js';

/**
 * Structural shape of the CDP event source. The product-side wrapper
 * adapts whichever CDP client it has (chrome-remote-interface,
 * WDIO/Playwright/Puppeteer CDP sessions, …) to this minimal interface.
 *
 * `on(event, handler)` MUST return an unsubscribe function; if the
 * underlying client doesn't natively expose unsubscribe, the wrapper is
 * responsible for synthesizing one.
 *
 * `getResponseBody`, when present, mirrors CDP's
 * `Network.getResponseBody` reply: `{ body, base64Encoded }`. The adapter
 * only calls it when `captureResponseBodies: true` (and silently skips
 * binary `base64Encoded: true` payloads — we don't redact binary, so
 * tagging it would mislead consumers).
 */
export interface CDPNetworkEventSource {
  on(event: string, handler: (params: unknown) => void): () => void;
  getResponseBody?(requestId: string): Promise<{ body: string; base64Encoded: boolean }>;
}

/**
 * Factory-time options for `createCDPNetworkAdapter`.
 */
export interface CDPNetworkOptions {
  /**
   * Try to fetch response bodies via `getResponseBody` when the event
   * source exposes it. Defaults to `false` because CDP retains bodies in
   * the renderer until fetched (memory tax) and the request/response
   * metadata is usually enough for triage.
   */
  captureResponseBodies?: boolean;
  /**
   * Body cap forwarded to `redactBody`. Defaults to 1 MB (the masking
   * module's own default — listed here for discoverability).
   */
  maxBodyBytes?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// CDP event payload shapes — narrowed inline via runtime checks.
//
// We define just enough of each event's shape to satisfy the adapter; the
// CDP protocol surface is huge and re-typing it would couple the substrate
// to a specific protocol version. `unknown`-then-narrow keeps us honest.
// ────────────────────────────────────────────────────────────────────────────

interface RequestWillBeSentParams {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
    hasPostData?: boolean;
  };
  /** CDP timestamp is monotonic seconds since process start, NOT epoch. */
  timestamp?: number;
  /** Wall-clock seconds since epoch — present on most builds, used when available. */
  wallTime?: number;
  initiator?: { type?: string; url?: string };
  type?: string;
}

interface ResponseReceivedParams {
  requestId: string;
  timestamp?: number;
  type?: string;
  response: {
    url: string;
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    fromPrefetchCache?: boolean;
    mimeType?: string;
    encodedDataLength?: number;
  };
}

interface LoadingFinishedParams {
  requestId: string;
  timestamp?: number;
  encodedDataLength?: number;
}

interface LoadingFailedParams {
  requestId: string;
  timestamp?: number;
  errorText: string;
  type?: string;
}

// Internal correlation record. We keep one entry per in-flight request so
// we can compute `durationMs`, attach response headers, and reuse the
// initial timestamps in the terminal events.
interface InFlight {
  startTs: number;
  startMonotonic: number | undefined;
  request: CapturedRequest;
  response?: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    fromCache: boolean;
    mimeType?: string;
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Convert a CDP monotonic timestamp (seconds since process start) to an
 * approximate wall-clock ms epoch using a request-time offset. Falls back
 * to `Date.now()` when neither side has the data we need — losing a few
 * ms of precision in exchange for a usable timestamp every time.
 */
function deriveTs(
  startTs: number,
  startMonotonic: number | undefined,
  eventMonotonic: number | undefined,
): number {
  if (startMonotonic !== undefined && eventMonotonic !== undefined) {
    return startTs + (eventMonotonic - startMonotonic) * 1000;
  }
  return Date.now();
}

/**
 * Build a `NetworkCaptureAdapter` that consumes CDP `Network.*` events.
 *
 * The adapter installs its own subscriptions on `source` and tracks
 * in-flight requests in an internal `Map` keyed by CDP `requestId`. The
 * map is cleared lazily as terminal events arrive; calling `dispose()`
 * unsubscribes all four CDP listeners and drops any remaining entries.
 *
 * @param source A `CDPNetworkEventSource` (typically a thin wrapper around
 *               the CDP client owned by the calling framework).
 * @param options `{ captureResponseBodies?, maxBodyBytes? }`.
 */
export function createCDPNetworkAdapter(
  source: CDPNetworkEventSource,
  options: CDPNetworkOptions = {},
): NetworkCaptureAdapter {
  const captureBodies = options.captureResponseBodies ?? false;
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

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
  // Network.requestWillBeSent
  // ──────────────────────────────────────────────────────────────────────
  const unsubRequest = source.on('Network.requestWillBeSent', (params) => {
    if (params === null || typeof params !== 'object') return;
    const p = params as Partial<RequestWillBeSentParams> & { request?: unknown };
    const requestId = readString(p.requestId);
    if (requestId === undefined) return;
    const reqObj = (p.request ?? {}) as Partial<RequestWillBeSentParams['request']>;

    // `wallTime` is in seconds (CDP convention); we store ms epoch.
    const wallTime = readNumber(p.wallTime);
    const startTs = wallTime !== undefined ? wallTime * 1000 : Date.now();
    const startMonotonic = readNumber(p.timestamp);

    const rawHeaders = readRecord(reqObj.headers);
    const headers = redactNetworkHeaders(rawHeaders);

    const initiatorObj = (p.initiator ?? undefined) as
      | { type?: unknown; url?: unknown }
      | undefined;
    const initiator = readString(initiatorObj?.url) ?? readString(initiatorObj?.type) ?? undefined;

    const rawBody = readString(reqObj.postData);
    const requestBody =
      rawBody !== undefined ? redactBody(rawBody, { maxLengthBytes: maxBodyBytes }) : undefined;

    const captured: CapturedRequest = {
      id: requestId,
      ts: startTs,
      url: readString(reqObj.url) ?? '',
      method: readString(reqObj.method) ?? 'GET',
      headers,
      ...(requestBody !== undefined ? { requestBody } : {}),
      ...(initiator !== undefined ? { initiator } : {}),
      ...(readString(p.type) !== undefined ? { resourceType: readString(p.type) as string } : {}),
    };

    inFlight.set(requestId, {
      startTs,
      startMonotonic,
      request: captured,
    });
    emitRequest(captured);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Network.responseReceived — record metadata; defer emission until
  // loadingFinished so we can fill durationMs + encodedSize in one pass.
  // ──────────────────────────────────────────────────────────────────────
  const unsubResponseReceived = source.on('Network.responseReceived', (params) => {
    if (params === null || typeof params !== 'object') return;
    const p = params as Partial<ResponseReceivedParams> & { response?: unknown };
    const requestId = readString(p.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    if (entry === undefined) return; // out-of-order or pre-attach event

    const respObj = (p.response ?? {}) as Partial<ResponseReceivedParams['response']>;
    const rawHeaders = readRecord(respObj.headers);
    const fromCache =
      respObj.fromDiskCache === true ||
      respObj.fromServiceWorker === true ||
      respObj.fromPrefetchCache === true;

    entry.response = {
      status: readNumber(respObj.status) ?? 0,
      ...(readString(respObj.statusText) !== undefined
        ? { statusText: readString(respObj.statusText) as string }
        : {}),
      headers: redactNetworkHeaders(rawHeaders),
      fromCache,
      ...(readString(respObj.mimeType) !== undefined
        ? { mimeType: readString(respObj.mimeType) as string }
        : {}),
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // Network.loadingFinished — terminal success; emit CapturedResponse.
  // ──────────────────────────────────────────────────────────────────────
  const unsubLoadingFinished = source.on('Network.loadingFinished', (params) => {
    if (params === null || typeof params !== 'object') return;
    const p = params as Partial<LoadingFinishedParams>;
    const requestId = readString(p.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    if (entry === undefined) return;

    const finishMonotonic = readNumber(p.timestamp);
    const ts = deriveTs(entry.startTs, entry.startMonotonic, finishMonotonic);
    const durationMs = Math.max(0, ts - entry.startTs);
    const encodedSize = readNumber(p.encodedDataLength);

    const response = entry.response ?? {
      status: 0,
      headers: {},
      fromCache: false,
    };

    // We resolve the response body separately so a failure here doesn't
    // block emission of the terminal event. The fetch is fire-and-forget
    // from the caller's perspective (we await before emitting, but errors
    // are swallowed — the response shape stays correct without the body).
    const finalize = (responseBody: string | undefined): void => {
      const captured: CapturedResponse = {
        id: requestId,
        ts,
        status: response.status,
        ...(response.statusText !== undefined ? { statusText: response.statusText } : {}),
        headers: response.headers,
        ...(responseBody !== undefined ? { responseBody } : {}),
        fromCache: response.fromCache,
        ...(encodedSize !== undefined ? { encodedSize } : {}),
        durationMs,
      };
      inFlight.delete(requestId);
      emitResponse(captured);
    };

    if (captureBodies && source.getResponseBody !== undefined) {
      void source
        .getResponseBody(requestId)
        .then((reply) => {
          // Skip binary payloads — we'd have to base64-decode + sniff the
          // mime to do anything useful with them, and the masking module
          // operates on strings.
          if (reply.base64Encoded) {
            finalize(undefined);
            return;
          }
          finalize(redactBody(reply.body, { maxLengthBytes: maxBodyBytes }));
        })
        .catch(() => {
          // CDP rejects `getResponseBody` for several legitimate reasons
          // (preflight responses, redirects, ‘no data’ for 204s). Swallow
          // and emit without a body — the metadata is still useful.
          finalize(undefined);
        });
    } else {
      finalize(undefined);
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Network.loadingFailed — terminal failure; emit CapturedResponse with
  // errorText AND (when subscribed) the parallel onError event.
  // ──────────────────────────────────────────────────────────────────────
  const unsubLoadingFailed = source.on('Network.loadingFailed', (params) => {
    if (params === null || typeof params !== 'object') return;
    const p = params as Partial<LoadingFailedParams>;
    const requestId = readString(p.requestId);
    if (requestId === undefined) return;
    const entry = inFlight.get(requestId);
    const errorText = readString(p.errorText) ?? 'unknown';

    const failMonotonic = readNumber(p.timestamp);
    const startTs = entry?.startTs ?? Date.now();
    const ts =
      entry !== undefined ? deriveTs(startTs, entry.startMonotonic, failMonotonic) : startTs;
    const durationMs = entry !== undefined ? Math.max(0, ts - startTs) : undefined;

    const response = entry?.response ?? {
      status: 0,
      headers: {},
      fromCache: false,
    };

    const captured: CapturedResponse = {
      id: requestId,
      ts,
      status: response.status,
      ...(response.statusText !== undefined ? { statusText: response.statusText } : {}),
      headers: response.headers,
      fromCache: response.fromCache,
      ...(durationMs !== undefined ? { durationMs } : {}),
      errorText,
    };
    inFlight.delete(requestId);
    emitResponse(captured);
    emitError({ id: requestId, ts, errorText });
  });

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
      unsubRequest();
      unsubResponseReceived();
      unsubLoadingFinished();
      unsubLoadingFailed();
      requestHandlers.clear();
      responseHandlers.clear();
      errorHandlers.clear();
      inFlight.clear();
    },
  };
}
