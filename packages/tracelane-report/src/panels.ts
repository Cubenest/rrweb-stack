// Console + network panel extraction (Task 2.10).
//
// Pure, build-time functions that walk the rrweb event stream and produce the
// compact row arrays embedded into the report (the in-page bootstrap only
// renders them — no event filtering happens in the browser). Extracting at
// build time keeps all the parsing logic unit-testable and the runtime thin.
//
// Sources (P1 PRD §F.3 / §E.2):
//   • Console — EventType.Plugin (6) with data.plugin === 'rrweb/console@1'.
//   • Network — EventType.Custom (5) with data.tag === 'tracelane.test.network-error'
//     (the v1.1 rich path); falls back to scraping console.error messages
//     prefixed '[tracelane.net]' (the v1 path) when no custom events exist.

import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';

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
/** Custom-event tag for the v1.1 rich network path (P1 PRD §E.3). */
export const NETWORK_EVENT_TAG = 'tracelane.test.network-error';
/** console.error prefix for the v1 network fallback (P1 PRD §E.2). */
export const NETWORK_CONSOLE_PREFIX = '[tracelane.net]';

interface PluginEventData {
  plugin?: unknown;
  payload?: { level?: unknown; payload?: unknown; trace?: unknown };
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
    const level = typeof data.payload?.level === 'string' ? data.payload.level : 'log';
    const message = stringifyArgs(data.payload?.payload);
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
 * Extract network-error rows. Prefers the v1.1 custom-event path
 * (EventType.Custom, tag 'tracelane.test.network-error'); when none are present,
 * falls back to scraping console.error lines prefixed '[tracelane.net]' (v1).
 */
export function extractNetwork(events: readonly eventWithTime[]): NetworkEntry[] {
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

  // v1 fallback: scrape the console.
  const scraped: NetworkEntry[] = [];
  for (const row of extractConsole(events)) {
    const parsed = parseNetConsoleLine(row.message, row.timestamp);
    if (parsed) scraped.push(parsed);
  }
  return scraped;
}
