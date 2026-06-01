// Console + network panel extraction (Task 2.10).
//
// Pure, build-time functions that walk the rrweb event stream and produce the
// compact row arrays embedded into the report (the in-page bootstrap only
// renders them — no event filtering happens in the browser). Extracting at
// build time keeps all the parsing logic unit-testable and the runtime thin.
//
// Sources (P1 PRD §F.3 / §E.2 + Phase 5 network-plugin integration):
//   • Console — EventType.Plugin (6) with data.plugin === 'rrweb/console@1'.
//     The CDP network-scrape lines ('[tracelane.net] …') are filtered OUT of
//     the console panel (they're a network signal, surfaced as Network rows).
//   • Network — UNION of the framework-agnostic in-page plugin
//     (EventType.Plugin (6), data.plugin === 'rrweb/network@1'; ships in
//     `@cubenest/rrweb-core`) and the v1 CDP console-scrape
//     ('[tracelane.net]'), where the CDP row's AUTHORITATIVE status wins for
//     an overlapping request. Falls back to the v1.1 EventType.Custom (5)
//     path (tag 'tracelane.test.network-error') for pre-Phase-5 recorders
//     that emitted neither source.

import { EventType, NETWORK_PLUGIN_NAME } from '@cubenest/rrweb-core';
import type { CapturedNetworkRequest, NetworkData, eventWithTime } from '@cubenest/rrweb-core';

/** A console panel row. */
export interface ConsoleEntry {
  level: string;
  message: string;
  timestamp: number;
}

/** A network-error panel row. */
export interface NetworkEntry {
  method?: string;
  url: string;
  status: number;
  timestamp: number;
}

/** rrweb console plugin tag (P1 PRD §F.3). */
export const CONSOLE_PLUGIN = 'rrweb/console@1';
/**
 * rrweb network plugin tag — the framework-agnostic in-page capture
 * (`rrweb/network@1`). Re-exported from `@cubenest/rrweb-core` so it stays
 * in sync with the substrate's wire-format contract.
 */
export const NETWORK_PLUGIN = NETWORK_PLUGIN_NAME;
/** Custom-event tag for the v1.1 rich network path (P1 PRD §E.3). */
export const NETWORK_EVENT_TAG = 'tracelane.test.network-error';
/** console.error prefix for the v1 network fallback (P1 PRD §E.2). */
export const NETWORK_CONSOLE_PREFIX = '[tracelane.net]';

interface PluginEventData {
  plugin?: unknown;
  // The console plugin nests level/args under data.payload; the network plugin
  // puts a NetworkData object there. Kept as `unknown` so each branch casts to
  // the plugin-specific shape it expects.
  payload?: unknown;
}
interface ConsolePluginPayload {
  level?: unknown;
  payload?: unknown;
  trace?: unknown;
}
interface CustomEventData {
  tag?: unknown;
  payload?: unknown;
}

function isPlugin(e: eventWithTime): boolean {
  return e.type === EventType.Plugin;
}
function isCustom(e: eventWithTime): boolean {
  return e.type === EventType.Custom;
}

/** Coerce an arbitrary console-arg payload into a flat display string. */
function stringifyArgs(payload: unknown): string {
  if (Array.isArray(payload)) {
    return payload
      .map((a) => (typeof a === 'string' ? stripQuotes(a) : safeStringify(a)))
      .join(' ');
  }
  return typeof payload === 'string' ? payload : safeStringify(payload);
}

// The console plugin serializes string args as JSON (so they arrive quoted,
// e.g. '"hello"'); unwrap a single layer of quoting for readability.
function stripQuotes(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      const parsed: unknown = JSON.parse(s);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // not JSON — fall through
    }
  }
  return s;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * All console-plugin rows, UNFILTERED — EventType.Plugin events emitted by the
 * rrweb console plugin. The plugin nests the level + serialized args under
 * `data.payload`. This includes the CDP network-scrape lines
 * ('[tracelane.net] …'); `extractNetwork` reads those here to recover the
 * authoritative status, while `extractConsole` filters them out for its panel.
 */
function extractConsoleRows(events: readonly eventWithTime[]): ConsoleEntry[] {
  const rows: ConsoleEntry[] = [];
  for (const e of events) {
    if (!isPlugin(e)) continue;
    const data = e.data as PluginEventData;
    if (data.plugin !== CONSOLE_PLUGIN) continue;
    const payload = data.payload as ConsolePluginPayload | undefined;
    const level = typeof payload?.level === 'string' ? payload.level : 'log';
    const message = stringifyArgs(payload?.payload);
    rows.push({ level, message, timestamp: e.timestamp });
  }
  return rows;
}

/**
 * Extract console panel rows. Drops the CDP network-scrape lines
 * ('[tracelane.net] …'): they are a *network* signal that `extractNetwork`
 * already surfaces as structured rows in the Network panel. Letting them
 * through here double-renders the same failure as a raw console string,
 * inconsistently with the structured row (audit A-4).
 */
export function extractConsole(events: readonly eventWithTime[]): ConsoleEntry[] {
  return extractConsoleRows(events).filter((row) => !row.message.includes(NETWORK_CONSOLE_PREFIX));
}

/** Parse a '[tracelane.net] <METHOD> <STATUS> <URL>' console line, if it is one. */
function parseNetConsoleLine(message: string, timestamp: number): NetworkEntry | undefined {
  const idx = message.indexOf(NETWORK_CONSOLE_PREFIX);
  if (idx === -1) return undefined;
  const rest = message.slice(idx + NETWORK_CONSOLE_PREFIX.length).trim();
  // "GET 404 https://…"  or  "404 https://…"
  const m = rest.match(/^(?:([A-Z]+)\s+)?(\d{3})\s+(\S+)/);
  if (!m) return undefined;
  return {
    ...(m[1] !== undefined ? { method: m[1] } : {}),
    status: Number(m[2]),
    url: m[3] ?? '',
    timestamp,
  };
}

/**
 * initiatorTypes that come from a true fetch/XHR error path. The plugin tags
 * fetch/XHR wrapper rows with exactly these; everything else (img/script/link/
 * css/font/navigation/…) is a PerformanceObserver timing entry.
 */
const ERROR_PATH_INITIATORS = new Set(['fetch', 'xmlhttprequest']);

/**
 * Whether a `status === 0` request came from a *true* error path rather than
 * a PerformanceObserver timing entry (audit A-1).
 *
 * The in-page `rrweb/network@1` plugin's default mode is PerformanceObserver:
 * successful cross-origin SUB-resources (img/script/link/css/font — analytics,
 * CDN, Google Fonts) report `responseStatus: 0` per the Resource Timing spec
 * **even though they loaded with HTTP 200**. Treating those as failures
 * surfaces PHANTOM network errors. Only the fetch/XHR wrappers (and CDP rows)
 * report a real status, so a status-0 there is a genuine network error.
 *
 * Discriminator: an error-path row has `initiatorType` of `'fetch'` /
 * `'xmlhttprequest'` (and typically a `method`); a PerformanceObserver
 * sub-resource has a resource-type `initiatorType` (img/script/css/…) and no
 * `method`. We require either an explicit fetch/XHR initiatorType OR (no
 * initiatorType at all AND a `method`) — the latter covers older substrates
 * that omitted initiatorType on the wrapper rows.
 */
function isTrueErrorPath(req: CapturedNetworkRequest): boolean {
  const initiator = typeof req.initiatorType === 'string' ? req.initiatorType : undefined;
  if (initiator !== undefined) return ERROR_PATH_INITIATORS.has(initiator);
  // No initiatorType: a `method` indicates a fetch/XHR wrapper row (a true
  // request), whereas a PerformanceObserver entry never carries a method.
  return typeof req.method === 'string';
}

/**
 * Coerce a `CapturedNetworkRequest` from the network plugin into a
 * panel-visible `NetworkEntry`. Treats genuine network errors (`status === 0`
 * on a true fetch/XHR error path) and 4xx/5xx responses as "failed" — matches
 * the report's existing "Network errors" panel semantics. Returns `undefined`
 * for non-failed requests so the caller can skip them.
 *
 * A `status === 0` PerformanceObserver sub-resource is NOT a failure (see
 * {@link isTrueErrorPath}) — those are cross-origin resources that loaded fine
 * but report 0 per the Resource Timing spec.
 *
 * `fallbackTs` is the wrapping rrweb event's `timestamp` (wall-clock ms);
 * we prefer the captured request's `timestamp` field when present (also
 * wall-clock ms — `timeOrigin + requestMadeAt` in the plugin), and fall
 * back to the wrapping event's timestamp so panel ordering still works
 * when the plugin omits per-request `timestamp` (e.g. older substrates).
 */
function networkEntryFromCapturedRequest(
  req: CapturedNetworkRequest,
  fallbackTs: number,
): NetworkEntry | undefined {
  const status = typeof req.status === 'number' ? req.status : undefined;
  // Filter to FAILED requests only — the renderer's panel is "Network errors"
  // and the v1/v1.1 paths only ever surfaced failures. Successful 2xx/3xx
  // responses captured by the plugin's broader PerformanceObserver path are
  // intentionally dropped here. A status of 0 only counts as a failure when it
  // came from a true error path (fetch/XHR), never a PerformanceObserver
  // sub-resource that reports 0 per the Resource Timing spec (audit A-1).
  const isFailed =
    (status === 0 && isTrueErrorPath(req)) || (status !== undefined && status >= 400);
  if (!isFailed) return undefined;

  const ts = typeof req.timestamp === 'number' ? req.timestamp : fallbackTs;
  const url = typeof req.name === 'string' ? req.name : '';
  return {
    ...(typeof req.method === 'string' ? { method: req.method } : {}),
    url,
    status: status ?? 0,
    timestamp: ts,
  };
}

/** Normalize a URL for cross-source dedup (drop trailing slash + fragment). */
function networkKey(url: string): string {
  return url.replace(/#.*$/, '').replace(/\/$/, '');
}

/**
 * Extract network-error rows.
 *
 * The in-page rrweb network plugin (`rrweb/network@1`, the Phase 5 default)
 * captures via PerformanceObserver, so its rows are status-poor for
 * cross-origin requests. The legacy CDP `[tracelane.net]` console-scrape, when
 * present, carries the AUTHORITATIVE HTTP status. So rather than "first
 * non-empty source wins" — which would shadow the authoritative CDP rows
 * whenever the plugin emitted anything (audit A-4) — we UNION the plugin + CDP
 * sources, with CDP rows replacing an overlapping plugin row for the same URL.
 *
 * Resolution:
 *   1. Failed rows from the in-page network plugin (EventType.Plugin) merged
 *      with the v1 CDP console-scrape ('[tracelane.net]'), where a CDP row
 *      REPLACES an overlapping plugin row for the same request (real status
 *      wins over a PerformanceObserver 0). Output ordered by timestamp.
 *   2. If neither produced any rows, fall back to the v1.1 custom-event path
 *      (EventType.Custom) — pre-Phase-5 recorders that used neither the plugin
 *      nor the CDP console-scrape.
 */
export function extractNetwork(events: readonly eventWithTime[]): NetworkEntry[] {
  // 1a. The in-page network plugin (framework-agnostic; PerformanceObserver).
  const fromPlugin: NetworkEntry[] = [];
  for (const e of events) {
    if (!isPlugin(e)) continue;
    const data = e.data as PluginEventData;
    if (data.plugin !== NETWORK_PLUGIN) continue;
    const payload = data.payload as NetworkData | undefined;
    if (!payload || !Array.isArray(payload.requests)) continue;
    for (const req of payload.requests) {
      const entry = networkEntryFromCapturedRequest(req, e.timestamp);
      if (entry) fromPlugin.push(entry);
    }
  }

  // 1b. v1 CDP console-scrape — AUTHORITATIVE status. Read the unfiltered
  //     console rows here (extractConsole() drops these lines for its panel).
  const scraped: NetworkEntry[] = [];
  for (const row of extractConsoleRows(events)) {
    const parsed = parseNetConsoleLine(row.message, row.timestamp);
    if (parsed) scraped.push(parsed);
  }

  if (fromPlugin.length > 0 || scraped.length > 0) {
    // Merge: CDP rows are authoritative and replace an overlapping plugin row
    // for the same URL; everything non-overlapping from both is retained.
    const byKey = new Map<string, NetworkEntry>();
    for (const entry of fromPlugin) byKey.set(networkKey(entry.url), entry);
    for (const entry of scraped) byKey.set(networkKey(entry.url), entry);
    return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  // 2. v1.1 fallback: rich custom events (pre-Phase-5 recorders).
  const rich: NetworkEntry[] = [];
  for (const e of events) {
    if (!isCustom(e)) continue;
    const data = e.data as CustomEventData;
    if (data.tag !== NETWORK_EVENT_TAG) continue;
    const p = (data.payload ?? {}) as {
      method?: unknown;
      url?: unknown;
      status?: unknown;
    };
    rich.push({
      ...(typeof p.method === 'string' ? { method: p.method } : {}),
      url: typeof p.url === 'string' ? p.url : '',
      status: typeof p.status === 'number' ? p.status : 0,
      timestamp: e.timestamp,
    });
  }
  return rich;
}
