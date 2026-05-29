// Public types for the network capture plugin.
//
// `CapturedNetworkRequest`, `NetworkData`, and `NetworkRecordOptions` are
// the wire-format contract — they get serialized into rrweb Plugin events
// with `data.plugin === 'rrweb/network@1'` and replayed by consumer-side
// extractors (tracelane-report panel, peek-mcp ingest).
//
// The plugin name is kept verbatim from upstream rrweb PR #1689 so that
// when (if) upstream lands, replay tooling can swap implementations
// without changing the event payload contract.

/**
 * The plugin name string. MUST stay verbatim — replay tooling matches on
 * this in `eventWithTime.data.plugin`.
 */
export const NETWORK_PLUGIN_NAME = 'rrweb/network@1' as const;

/**
 * The Resource Timing initiator types we filter on when reading
 * `PerformanceResourceTiming` entries. Verbatim from the W3C resource
 * timing spec. Listed as a union for type-safety on the
 * `initiatorTypes` option.
 */
export type InitiatorType =
  | 'audio'
  | 'beacon'
  | 'body'
  | 'css'
  | 'early-hint'
  | 'embed'
  | 'fetch'
  | 'frame'
  | 'iframe'
  | 'icon'
  | 'image'
  | 'img'
  | 'input'
  | 'link'
  | 'navigation'
  | 'object'
  | 'ping'
  | 'script'
  | 'track'
  | 'video'
  | 'xmlhttprequest';

/**
 * Headers shape — plain object so it can be serialized as JSON. We
 * normalize fetch `Headers` / `XMLHttpRequest.getAllResponseHeaders()`
 * into this lowest common denominator before emitting.
 */
export type NetworkHeaders = Record<string, string>;

/**
 * A single captured request. One of these is emitted per fetch / XHR /
 * PerformanceObserver entry.
 *
 * All optional fields may be `undefined` if the relevant source didn't
 * provide them (e.g. PerformanceObserver gives no body, no headers, no
 * method; a network error gives status 0 and no responseBody).
 */
export interface CapturedNetworkRequest {
  /** URL — may be query-string-redacted via `maskRequestFn`. */
  name: string;
  /** HTTP method (GET, POST, …). Undefined for PerformanceObserver entries. */
  method?: string | undefined;
  /**
   * HTTP status code. 0 indicates a network error (CORS, offline, abort).
   * Undefined for PerformanceObserver entries where status is unknown.
   */
  status?: number | undefined;
  /**
   * What initiated this request — `'fetch'`, `'xmlhttprequest'`,
   * `'navigation'`, or a resource type from {@link InitiatorType}.
   */
  initiatorType?: string | undefined;
  /** Total transferred bytes (Resource Timing). Undefined for fetch/XHR paths. */
  transferSize?: number | undefined;
  /** Round-trip duration in ms. Computed from start/end if not from PerformanceEntry. */
  duration?: number | undefined;
  /** Request headers (if `recordHeaders` enabled + passed mask). */
  requestHeaders?: NetworkHeaders | undefined;
  /** Response headers (if `recordHeaders` enabled + passed mask). */
  responseHeaders?: NetworkHeaders | undefined;
  /** Request body, post-mask (if `recordBody` enabled). */
  requestBody?: string | undefined;
  /** Response body, post-mask (if `recordBody` enabled). */
  responseBody?: string | undefined;
  /**
   * True for PerformanceObserver-emitted entries that pre-date the
   * fetch/XHR wrappers (page load resources, the navigation entry). These
   * never have method/status/headers/body and replay tooling typically
   * renders them differently.
   */
  isInitial?: boolean | undefined;
  /**
   * `performance.now()` at request start. We also expose this as
   * `startTime` for compatibility with PerformanceEntry consumers.
   */
  startTime?: number | undefined;
  /** `performance.now()` at response end. */
  endTime?: number | undefined;
  /** `Date.now() - performance.now()` snapshot — replay clock origin. */
  timeOrigin?: number | undefined;
  /** Wall-clock timestamp (ms since epoch) — `timeOrigin + startTime`. */
  timestamp?: number | undefined;
  /**
   * Resource entry type — set on entries that originate from the
   * PerformanceObserver. The standard set is `'resource'` /
   * `'navigation'`; we also emit `'serverTiming'` for per-serverTiming
   * synthetic entries (so replay can correlate timing names).
   */
  entryType?: string | undefined;
}

/**
 * A batch of captured requests emitted as one rrweb Plugin event payload.
 * Typically a batch is a single request, but the PerformanceObserver path
 * can emit several entries at once when the browser flushes its buffer.
 */
export interface NetworkData {
  requests: CapturedNetworkRequest[];
  /**
   * True if the entire batch represents PerformanceObserver entries that
   * pre-date the fetch/XHR wrappers. Mirrors per-request `isInitial`.
   */
  isInitial?: boolean | undefined;
}

/**
 * Per-direction header capture toggle. `recordHeaders: true` records
 * both directions; an object lets a consumer enable only one side
 * (e.g. response headers for status forensics without sending request
 * headers that may carry auth tokens upstream).
 */
export type RecordHeadersOption = boolean | { request: boolean; response: boolean };

/**
 * Body capture per direction. Three shapes:
 *
 *   - `boolean`              record (or skip) both directions
 *   - `string[]`             record both directions only when the
 *                            Content-Type starts with one of these
 *                            prefixes (e.g. `['application/json']`)
 *   - `{ request, response }` per-direction control; each side is one
 *                            of `boolean | string[]` with the same
 *                            semantics as above.
 */
export type RecordBodyOption =
  | boolean
  | string[]
  | { request: boolean | string[]; response: boolean | string[] };

/**
 * Custom transform/redactor invoked for every captured request before
 * emission. Return `null` to skip emission entirely, or a (possibly-
 * modified) request to forward to rrweb.
 *
 * The default mask provided by this package pipes through
 * `redactNetworkHeaders` (deny-list header values) and `redactBody`
 * (PII regex bank + truncation). If a consumer supplies their own
 * `maskRequestFn`, the default mask still runs FIRST (defense in
 * depth) and the consumer's function runs after.
 */
export type MaskRequestFn = (
  req: CapturedNetworkRequest,
) => CapturedNetworkRequest | null | undefined;

/**
 * Plugin options. All fields optional with sensible defaults; see
 * `defaultNetworkOptions` for current values.
 */
export interface NetworkRecordOptions {
  /**
   * If true, the plugin emits a synthetic "initial requests" batch on
   * startup that mirrors `performance.getEntries()` — useful so replay
   * shows the page-load network burst that happened before recording
   * started. Default `true`.
   */
  recordInitialRequests?: boolean | undefined;
  /**
   * Capture request/response headers. Off by default (privacy default).
   * Pass `true` to capture both directions, or `{ request, response }`
   * to control independently.
   */
  recordHeaders?: RecordHeadersOption | undefined;
  /**
   * Capture request/response bodies. Off by default (privacy default).
   * See {@link RecordBodyOption} for the three accepted shapes.
   *
   * When enabled, bodies pass through the masking pipeline before
   * emission and are truncated to `bodyByteLimit` per direction.
   */
  recordBody?: RecordBodyOption | undefined;
  /**
   * If true, install a PerformanceObserver to capture resource +
   * navigation timings even for requests we didn't wrap (e.g. images,
   * stylesheets, fonts, page navigations). Default `true`.
   */
  recordPerformance?: boolean | undefined;
  /**
   * Which `PerformanceObserver` entry types to observe. Default is
   * `['navigation', 'resource', 'first-input', 'paint']`. Caller can
   * narrow or extend (entries unsupported by the host browser are
   * silently filtered out via `PerformanceObserver.supportedEntryTypes`).
   */
  performanceEntryTypeToObserve?: string[] | undefined;
  /**
   * Which initiator types to capture from PerformanceObserver / XHR /
   * fetch wrappers. Default includes everything in {@link InitiatorType}.
   * Set to `['fetch', 'xmlhttprequest']` to ignore static asset noise.
   */
  initiatorTypes?: InitiatorType[] | undefined;
  /**
   * Hard cap on emitted body size, per direction. Bodies longer than
   * this are replaced with a truncation marker (`[truncated: N bytes]`).
   * Default 1_000_000 (1 MB) — matches the legacy PostHog limit.
   */
  payloadSizeLimitBytes?: number | undefined;
  /**
   * Per-body byte limit applied after masking. The masking pipeline's
   * own truncation (`maskBodyMaxBytes`) handles default-mask truncation;
   * this option is exposed for consumers building their own mask that
   * still wants the truncation marker. Default 5_000.
   */
  bodyByteLimit?: number | undefined;
  /**
   * Maximum requests per emitted batch. Excess requests in a single
   * `PerformanceObserver` flush are dropped. Default 1_000.
   */
  maxRequestsPerBatch?: number | undefined;
  /**
   * Hostnames whose request/response bodies we refuse to read. Match
   * is suffix-based, so `'.example.com'` matches `api.example.com` and
   * `foo.example.com`. Empty by default — consumers add their own
   * analytics/logging endpoints to avoid feedback loops.
   */
  payloadHostDenyList?: string[] | undefined;
  /**
   * Caller-supplied transform/filter — runs AFTER the default
   * masking pipeline. Return `null` to skip emission entirely.
   */
  maskRequestFn?: MaskRequestFn | undefined;
}
