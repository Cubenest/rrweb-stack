// Console + network panel extraction (Task 2.10).
//
// Pure, build-time functions that walk the rrweb event stream and produce the
// compact row arrays embedded into the report (the in-page bootstrap only
// renders them — no event filtering happens in the browser). Extracting at
// build time keeps all the parsing logic unit-testable and the runtime thin.
//
// Sources (P1 PRD §F.3 / §E.2 + Phase 5 network-plugin integration):
//   • Console — EventType.Plugin (6) with data.plugin === 'rrweb/console@1'.
//   • Network — preferred path: EventType.Plugin (6) with
//     data.plugin === 'rrweb/network@1' (the framework-agnostic in-page
//     plugin; ships in `@cubenest/rrweb-core`). Falls back to the v1.1
//     EventType.Custom (5) path (tag 'tracelane.test.network-error') for
//     sessions captured by pre-Phase-5 recorders, and finally to scraping
//     console.error lines prefixed '[tracelane.net]' (v1).

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
 * Extract console rows: EventType.Plugin events emitted by the rrweb console
 * plugin. The plugin nests the level + serialized args under `data.payload`.
 */
export function extractConsole(events: readonly eventWithTime[]): ConsoleEntry[] {
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
 * Coerce a `CapturedNetworkRequest` from the network plugin into a
 * panel-visible `NetworkEntry`. Treats network errors (`status === 0`) and
 * 4xx/5xx responses as "failed" — matches the report's existing "Network
 * errors" panel semantics. Returns `undefined` for non-failed requests so
 * the caller can skip them.
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
  // intentionally dropped here.
  const isFailed = status === 0 || (status !== undefined && status >= 400);
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

/**
 * Extract network-error rows. Resolution order (first non-empty wins):
 *   1. The framework-agnostic rrweb network plugin (`rrweb/network@1`,
 *      EventType.Plugin) — Phase 5 default.
 *   2. The v1.1 custom-event path (EventType.Custom, tag
 *      'tracelane.test.network-error') — fallback for sessions captured by
 *      pre-Phase-5 recorders.
 *   3. The v1 console-scrape path — fallback for the earliest recorders.
 */
export function extractNetwork(events: readonly eventWithTime[]): NetworkEntry[] {
  // 1. The in-page network plugin (preferred — framework-agnostic).
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
  if (fromPlugin.length > 0) return fromPlugin;

  // 2. v1.1 fallback: rich custom events.
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
  if (rich.length > 0) return rich;

  // 3. v1 fallback: scrape the console.
  const scraped: NetworkEntry[] = [];
  for (const row of extractConsole(events)) {
    const parsed = parseNetConsoleLine(row.message, row.timestamp);
    if (parsed) scraped.push(parsed);
  }
  return scraped;
}
