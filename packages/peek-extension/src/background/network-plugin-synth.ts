/**
 * Network-plugin event synthesizer (alpha.6, Phase 5 task #72).
 *
 * Background:
 *
 *   The MAIN-world recorder used to monkey-patch `window.fetch` +
 *   `XMLHttpRequest.prototype.*` and post `NetMessage` envelopes
 *   (`source: 'peek-net'`) through the ISOLATED relay → SW route, where the SW
 *   forwarded them to peek-mcp via `network.append`. peek-mcp's
 *   `network_events` SQLite table + the `get_session_network_errors` MCP tool
 *   are both fed from that channel.
 *
 *   In alpha.6 the manual wrappers are REPLACED by
 *   `getRecordNetworkPlugin()` from `@cubenest/rrweb-core` (the
 *   framework-agnostic plugin Phase 1 shipped). The plugin emits
 *   `EventType.Plugin` (type === 6) events with
 *   `data.plugin === 'rrweb/network@1'` through the SAME `emit` callback that
 *   rrweb uses for DOM + console events — so they ride the `recorder.events`
 *   channel (eventually `session.append`), NOT the `recorder.net`/`network.append`
 *   channel.
 *
 * Problem if we did nothing:
 *
 *   `get_session_network_errors` would return EMPTY for every session captured
 *   after alpha.6 because nothing writes to `network_events` anymore. AI
 *   consumers (the whole point of peek-mcp) lose the ability to query
 *   network failures.
 *
 * Solution (this module):
 *
 *   When the SW receives `EventType.Plugin` / `'rrweb/network@1'` events from
 *   the ISOLATED relay, it walks each `payload.requests[]` and synthesizes
 *   one or two `NetMessage` envelopes (a `request` open + a `response` close,
 *   or an `error`) matching the legacy wire shape. The SW DOUBLE-WRITES:
 *
 *     1. the plugin events stay in the rrweb stream → `session.append` →
 *        `events_chunks` gzipped blob — preserves the data for future
 *        read-path migration (alpha.10+) that walks the stream directly;
 *     2. the synthesized `NetMessage[]` go through `networkAppend()` →
 *        `network_events` SQLite rows — preserves backward compat for
 *        `get_session_network_errors` today.
 *
 *   REMOVAL: drop this synthesizer (and the call site in
 *   `entrypoints/background.ts`) in alpha.10 once `get_session_network_errors`
 *   reads from the rrweb event stream directly via @cubenest/rrweb-core's
 *   network-plugin event extractor (the same extractor @tracelane/report's
 *   panels.ts already uses — see phase5-network-plugin-phase2-tracelane.md).
 *   The double-write window is intentional to keep the migration reversible.
 *
 * Threat model alignment: the plugin's DEFAULT `maskRequestFn` runs the
 * @cubenest/rrweb-core mask pipeline (redactBody, redactNetworkHeaders,
 * URL-redaction) BEFORE emitting. The synthesizer here therefore sees
 * already-masked values — there is no raw-secret window in this code path.
 */

import type { CapturedNetworkRequest, NetworkData } from '@cubenest/rrweb-core';
import type { NetMessage } from '../recorder/messages.js';

/** rrweb's `EventType.Plugin` numeric value. */
const EVENT_TYPE_PLUGIN = 6;
/** The network plugin's stable name in `eventWithTime.data.plugin`. */
const NETWORK_PLUGIN_NAME = 'rrweb/network@1';

/**
 * Minimal shape of an rrweb network plugin event as it arrives over
 * `chrome.runtime.sendMessage` from the ISOLATED relay. We deliberately type
 * this defensively (everything is `unknown`-narrowed) — the relay validates
 * the outer `source` tag, but the inner shape is whatever the page realm
 * produced. The synthesizer NEVER throws on a malformed event.
 */
interface PluginNetworkEvent {
  type: typeof EVENT_TYPE_PLUGIN;
  timestamp?: number;
  data: {
    plugin: typeof NETWORK_PLUGIN_NAME;
    payload: NetworkData;
  };
}

/**
 * Predicate — is this event the network plugin's event shape we want to
 * synthesize from? Mirrors the same `type === 6 && data.plugin === ...`
 * gate `isConsolePluginEvent` uses for the console plugin (defense in depth
 * on the shape, not just the discriminator).
 */
export function isNetworkPluginEvent(event: unknown): event is PluginNetworkEvent {
  if (typeof event !== 'object' || event === null) return false;
  const ev = event as { type?: unknown; data?: { plugin?: unknown; payload?: unknown } };
  if (ev.type !== EVENT_TYPE_PLUGIN) return false;
  if (ev.data === undefined || ev.data === null) return false;
  if (ev.data.plugin !== NETWORK_PLUGIN_NAME) return false;
  const payload = ev.data.payload as { requests?: unknown } | undefined;
  if (payload === undefined || payload === null) return false;
  return Array.isArray(payload.requests);
}

/**
 * Walk an event stream and synthesize `NetMessage[]` from any network plugin
 * events it contains. Returns an empty array when no plugin events are present
 * (the common case — most batches are pure DOM events).
 *
 * Idempotent + pure: same input → same output, no side effects.
 */
export function synthesizeNetMessagesFromEvents(events: readonly unknown[]): NetMessage[] {
  const out: NetMessage[] = [];
  for (const ev of events) {
    if (!isNetworkPluginEvent(ev)) continue;
    const eventTs = typeof ev.timestamp === 'number' ? ev.timestamp : Date.now();
    const requests = ev.data.payload.requests;
    for (const req of requests) {
      synthesizeOne(req, eventTs, out);
    }
  }
  return out;
}

/**
 * Synthesize one or two `NetMessage` envelopes from a single
 * `CapturedNetworkRequest`. Pushes onto `out` rather than returning so the
 * outer walker does one allocation pass.
 *
 * Lifecycle mapping (preserves peek-mcp's per-request open/close model — the
 * `network_events` ingest expects request + response rows correlated by `id`):
 *
 *   1. ALWAYS emit a `request` envelope.
 *   2. THEN emit either:
 *        - an `error` envelope when `status === 0` (network failure: CORS,
 *          offline, abort) — `get_session_network_errors` filters on
 *          `error_text IS NOT NULL` for this case;
 *        - a `response` envelope otherwise (including the `status === undefined`
 *          PerformanceObserver-initial path, where we forward as a successful
 *          response with `status: 0` and let the read query ignore those rows
 *          via its `status >= 400` predicate).
 *
 * Field mapping (NetMessage shape ↔ CapturedNetworkRequest shape):
 *
 *   - `id`            ← deterministic-ish `plugin-<timeOrigin>-<requestMadeAt>-<urlTail>`
 *                       (the plugin does not provide a correlation id; this
 *                       string is stable for replay/retry consistency and
 *                       short enough to fit ingest's TEXT column comfortably).
 *   - `ts`            ← `timestamp` (wall-clock ms) when present, else the
 *                       event's `timestamp`, else `Date.now()`.
 *   - `transport`     ← derived from `initiatorType`:
 *                         'xmlhttprequest' → 'xhr', 'fetch' → 'fetch', other
 *                         (image/script/css/PerformanceObserver) → undefined.
 *                       peek-mcp stores this as `resource_type`; undefined
 *                       lands as SQL NULL (the ingest path normalizes — see
 *                       packages/peek-mcp/src/native-host/ingest.ts L365).
 *   - `method`        ← `req.method` if present, else `'GET'` (the legacy
 *                       wrapper defaulted to `'GET'` for XHR with no open()).
 *   - `url`           ← `req.name` (already masked by the plugin's default
 *                       maskRequestFn pipeline).
 *   - `headers`       ← `req.requestHeaders` / `req.responseHeaders` when
 *                       `recordHeaders` is on (alpha.6 default OFF → omitted).
 *   - `requestBody` / `responseBody`
 *                     ← when `recordBody` is on (alpha.6 default OFF → omitted).
 *                       The ingest path tolerates missing bodies (P-18 fix).
 *   - `status`        ← `req.status` for response, omitted otherwise.
 *   - `error`         ← derived string for `status === 0` (the plugin signals
 *                       network failure via status 0; we surface a human
 *                       string so SQLite's `error_text IS NOT NULL` predicate
 *                       in `getNetworkErrors` lights up the row).
 */
function synthesizeOne(req: CapturedNetworkRequest, eventTs: number, out: NetMessage[]): void {
  // Wall-clock ts: prefer the plugin's `timestamp` (timeOrigin + requestMadeAt),
  // fall back to the rrweb event ts, finally `Date.now()`. The plugin can omit
  // `timestamp` for PerformanceObserver-only entries where wall-clock origin
  // wasn't sampled — match what the legacy wrappers did (Date.now()).
  const requestTs = typeof req.timestamp === 'number' ? req.timestamp : eventTs;
  const responseTs =
    typeof req.responseEnd === 'number' && typeof req.timeOrigin === 'number'
      ? req.timeOrigin + req.responseEnd
      : requestTs;

  const transport = mapTransport(req.initiatorType);
  const method = typeof req.method === 'string' ? req.method : 'GET';
  const id = synthId(req);

  // 1. request envelope (always)
  const request: NetMessage = {
    kind: 'request',
    id,
    ts: requestTs,
    method,
    url: req.name,
  };
  if (transport !== undefined) request.transport = transport;
  if (req.requestHeaders !== undefined) request.headers = req.requestHeaders;
  if (req.requestBody !== undefined) request.requestBody = req.requestBody;
  out.push(request);

  // 2. response or error envelope (always — peek-mcp's per-request lifecycle
  // expects a close so the row's status/error columns land).
  if (req.status === 0) {
    // status === 0 ⇒ network failure (CORS/abort/offline). Surface as an
    // `error` envelope so `error_text IS NOT NULL` in `getNetworkErrors`
    // catches it. The plugin doesn't expose the underlying error string, so
    // synthesize a generic one.
    out.push({
      kind: 'error',
      id,
      ts: responseTs,
      error: 'network error (status 0)',
    });
    return;
  }

  const response: NetMessage = {
    kind: 'response',
    id,
    ts: responseTs,
    // PerformanceObserver-only entries leave `status` undefined; default to 0
    // so the row inserts (ingest sees null vs number — NULL is fine, but the
    // legacy wrappers always wrote a number, so we match). The read query's
    // `status >= 400` predicate filters PerformanceObserver-zero rows out of
    // the error list automatically.
    status: typeof req.status === 'number' ? req.status : 0,
  };
  if (req.responseHeaders !== undefined) response.headers = req.responseHeaders;
  if (req.responseBody !== undefined) response.responseBody = req.responseBody;
  out.push(response);
}

/**
 * Map a Resource-Timing initiator type to peek's `transport` discriminator.
 * Only `fetch` + `xmlhttprequest` get a value (those are the channels peek
 * cares about); everything else (image, css, navigation, paint, …) maps to
 * `undefined` so peek-mcp's `resource_type` column stores SQL NULL and the
 * MCP read queries ignore it.
 */
function mapTransport(initiatorType: string | undefined): 'fetch' | 'xhr' | undefined {
  if (initiatorType === 'fetch') return 'fetch';
  if (initiatorType === 'xmlhttprequest') return 'xhr';
  return undefined;
}

/**
 * Build a synthetic correlation id for a `CapturedNetworkRequest`. The plugin
 * doesn't expose one (each call site invents its own); peek-mcp's
 * `network_events.request_id` is a TEXT column that just needs a stable
 * non-null value per request for the per-row open/close pairing to make sense.
 *
 * Format: `plugin-<timeOrigin-or-0>-<requestMadeAt-or-eventTs>-<urlTail>`.
 * Caps the URL tail at 32 chars so the id fits comfortably in the column and
 * never leaks a long full URL into ids.
 */
function synthId(req: CapturedNetworkRequest): string {
  const timeOrigin = typeof req.timeOrigin === 'number' ? Math.floor(req.timeOrigin) : 0;
  const requestMadeAt =
    typeof req.requestMadeAt === 'number' ? Math.floor(req.requestMadeAt) : Date.now();
  const urlTail = typeof req.name === 'string' ? req.name.slice(-32) : '';
  return `plugin-${timeOrigin}-${requestMadeAt}-${urlTail}`;
}
