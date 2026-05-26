// Network capture abstraction — Task 1.7.
//
// ADR-0002: both products consume the same downstream API, only the
// transport differs. P1/tracelane subscribes to CDP `Network.*` via a
// WebDriver-supplied CDP session; P2/peek subscribes to
// `chrome.webRequest.*` from the extension service worker.
//
// The shapes below are the contract — `createCDPNetworkAdapter` and
// `createWebRequestNetworkAdapter` MUST produce structurally identical
// `CapturedRequest`/`CapturedResponse` records (a cross-adapter equality
// test in `network.test.ts` is the regression guard). Field availability
// differs only in the well-documented cases:
//
//   - `requestBody`     — both transports can populate when present.
//   - `responseBody`    — CDP only (chrome.webRequest can't access bodies
//                         in MV3); CDP also requires opt-in via
//                         `CDPNetworkOptions.captureResponseBodies`.
//   - `initiator`       — CDP exposes it natively; chrome.webRequest does
//                         not (left undefined on the webRequest path).
//   - `resourceType`    — both transports expose this, but the vocabulary
//                         is transport-native (CDP: `Document`, `XHR`,
//                         `Fetch`, …; chrome.webRequest: `main_frame`,
//                         `xmlhttprequest`, …). We pass through verbatim
//                         and document the difference — re-mapping would
//                         throw away signal.
//   - `encodedSize`     — both transports populate when available (CDP
//                         via `Network.loadingFinished.encodedDataLength`;
//                         chrome.webRequest via the `responseSize` field
//                         on `onCompleted`).
//
// All sensitive material (headers + bodies) is redacted INSIDE the adapter
// before reaching the consumer's handler — see
// `redactNetworkHeaders`/`redactBody` from the masking module.

/**
 * A single in-flight (or about-to-be-sent) HTTP request, observed at the
 * `requestWillBeSent`-equivalent moment of each transport.
 *
 * Emitted by `NetworkCaptureAdapter.onRequest`. Headers are already redacted
 * via `redactNetworkHeaders`; `requestBody`, when present, is already passed
 * through `redactBody` (type-tagged token replacement + 1 MB cap).
 */
export interface CapturedRequest {
  /**
   * Unique request id — the transport-native identifier (CDP `requestId`
   * or chrome.webRequest `requestId`), reused verbatim so downstream
   * consumers can correlate request/response without a substrate-side map.
   */
  id: string;
  /** Wall-clock time (ms since epoch) when the request started. */
  ts: number;
  /** Fully-qualified request URL. */
  url: string;
  /** HTTP method — `'GET'`, `'POST'`, `'PUT'`, … */
  method: string;
  /**
   * Request headers, already passed through `redactNetworkHeaders` (deny-list
   * applied; non-sensitive names preserved with original casing).
   */
  headers: Record<string, string>;
  /**
   * Request body — already passed through `redactBody` (PII regex bank +
   * 1 MB truncation cap). Present only when the transport exposes a textual
   * body for the request; omitted otherwise (binary bodies, multipart, or
   * any transport that can't surface the bytes).
   */
  requestBody?: string;
  /**
   * Initiator hint — typically `'script'`, `'parser'`, `'other'`, or a URL
   * pointing at the script that scheduled the request. CDP populates this
   * natively; the webRequest adapter leaves it undefined (no equivalent
   * field).
   */
  initiator?: string;
  /**
   * Resource type, as reported by the transport. CDP vocabulary (e.g.
   * `'Document'`, `'XHR'`, `'Fetch'`, `'Image'`) differs from
   * chrome.webRequest's (e.g. `'main_frame'`, `'xmlhttprequest'`); we pass
   * through verbatim so downstream tooling sees the original signal.
   */
  resourceType?: string;
}

/**
 * The terminal observation of an HTTP exchange — either a successful response
 * (`status` populated, `errorText` undefined) or a failure
 * (`errorText` populated, `status` may be `0`). Bodies and headers are
 * already redacted as for `CapturedRequest`.
 */
export interface CapturedResponse {
  /** Matches the `id` of the corresponding `CapturedRequest`. */
  id: string;
  /** Wall-clock time (ms since epoch) when the response was observed. */
  ts: number;
  /** HTTP status code. `0` on network failure when no response was received. */
  status: number;
  /** HTTP status text (e.g. `'OK'`, `'Not Found'`). Optional — not all transports surface it. */
  statusText?: string;
  /** Response headers, already passed through `redactNetworkHeaders`. */
  headers: Record<string, string>;
  /**
   * Response body, already passed through `redactBody`. Only populated by
   * `createCDPNetworkAdapter` when `captureResponseBodies: true` AND the
   * caller wired a `getResponseBody` fetcher (and the body is textual).
   * Never populated by `createWebRequestNetworkAdapter` — chrome.webRequest
   * cannot access response bodies in MV3.
   */
  responseBody?: string;
  /** `true` when the response was served from the HTTP cache. */
  fromCache: boolean;
  /**
   * Number of bytes on the wire (post-compression), when the transport
   * reports it. CDP fills this from `Network.loadingFinished.encodedDataLength`;
   * chrome.webRequest fills it from `onCompleted.responseSize`.
   */
  encodedSize?: number;
  /** Elapsed time from request start to this observation, in ms, when known. */
  durationMs?: number;
  /**
   * Populated when the transport reports a transport-layer error
   * (CDP `Network.loadingFailed.errorText`, chrome.webRequest `onErrorOccurred.error`).
   * Mutually exclusive with a normal response in practice — when present,
   * the adapter emits this via `onResponse` rather than firing a separate
   * `onError` event, so consumers get a single terminal record per exchange.
   * (The optional `onError` channel is offered for products that want a
   * second signal; it carries the same id/ts/errorText.)
   */
  errorText?: string;
}

/**
 * Common surface for network capture. Both factories
 * (`createCDPNetworkAdapter`, `createWebRequestNetworkAdapter`) return this
 * shape; the only intended difference is which transport drives the
 * underlying subscription.
 *
 * Handler registration is additive: each `on*` call returns an unsubscribe
 * function specific to that handler. `dispose()` is a single shot — it
 * tears down ALL transport subscriptions for the adapter.
 */
export interface NetworkCaptureAdapter {
  /**
   * Subscribe to `CapturedRequest` emissions. The returned function removes
   * THIS handler without affecting other registered handlers.
   */
  onRequest(handler: (req: CapturedRequest) => void): () => void;
  /**
   * Subscribe to `CapturedResponse` emissions. Same unsubscribe semantics
   * as `onRequest`.
   */
  onResponse(handler: (res: CapturedResponse) => void): () => void;
  /**
   * Optional dedicated channel for transport-layer errors. Adapters that
   * surface errors only via `CapturedResponse.errorText` may leave this
   * undefined; adapters that fire a parallel error stream populate it.
   */
  onError?(handler: (err: { id: string; ts: number; errorText: string }) => void): () => void;
  /**
   * Tear down all underlying transport subscriptions. Idempotent. Returning
   * a promise so future adapters that flush async resources can do so
   * cleanly under the same contract.
   */
  dispose?(): Promise<void>;
}
