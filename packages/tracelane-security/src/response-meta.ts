import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { SEC_CONSOLE_PREFIX } from './index.js';

/**
 * Privacy-safe response metadata recovered from a `[tracelane.sec]` console
 * line. Carries only header NAMES (never values), per-cookie flag presence
 * booleans, and the cookie name — never header values or cookie values.
 */
export interface ResponseMeta {
  url: string;
  status: number;
  isMainDocument: boolean;
  /** lowercased header NAMES that were present (never values) */
  presentSecurityHeaders: string[];
  /** per-cookie flag presence (never names/values beyond the cookie name) */
  setCookies: { name: string; secure: boolean; httpOnly: boolean; sameSite: boolean }[];
}

/**
 * Coerce the first console-plugin arg into a flat string. The console plugin
 * JSON-encodes string args (so a logged string arrives double-quoted, e.g.
 * `'"hello"'`); unwrap a single layer of quoting when present. Mirrors
 * `stripQuotes` in `@tracelane/report`'s panels.ts.
 */
function consoleArgString(payload: unknown): string {
  const args = Array.isArray(payload) ? payload : [payload];
  const first = args[0];
  if (typeof first !== 'string') return '';
  if (first.length >= 2 && first.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(first);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* not JSON — fall through to raw */
    }
  }
  return first;
}

function isCookieFlags(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const k = c as Record<string, unknown>;
  return (
    typeof k.name === 'string' &&
    typeof k.secure === 'boolean' &&
    typeof k.httpOnly === 'boolean' &&
    typeof k.sameSite === 'boolean'
  );
}

/**
 * Full structural validation of a parsed `[tracelane.sec]` payload, including
 * array ELEMENT types. A page can emit a fake `[tracelane.sec]` console line, so
 * a shape-malformed object (e.g. `presentSecurityHeaders: [123]` or
 * `setCookies: [{}]`) must be rejected to honor the "malformed lines are
 * skipped" contract and protect downstream consumers from runtime errors.
 */
function isResponseMeta(parsed: unknown): parsed is ResponseMeta {
  if (!parsed || typeof parsed !== 'object') return false;
  const m = parsed as Record<string, unknown>;
  return (
    typeof m.url === 'string' &&
    typeof m.status === 'number' &&
    typeof m.isMainDocument === 'boolean' &&
    Array.isArray(m.presentSecurityHeaders) &&
    m.presentSecurityHeaders.every((h) => typeof h === 'string') &&
    Array.isArray(m.setCookies) &&
    m.setCookies.every(isCookieFlags)
  );
}

/**
 * Read privacy-safe `[tracelane.sec]` response metadata out of a captured rrweb
 * event stream. The capture layer emits these as
 * `console.error('[tracelane.sec] ' + JSON.stringify(meta))`, which the rrweb
 * console plugin records as `EventType.Plugin` events
 * (`data.plugin === 'rrweb/console@1'`, args under `data.payload.payload`).
 * Malformed lines are skipped.
 */
export function scrapeResponseMeta(events: readonly eventWithTime[]): ResponseMeta[] {
  const out: ResponseMeta[] = [];
  for (const e of events) {
    if (e.type !== EventType.Plugin) continue;
    const data = e.data as { plugin?: unknown; payload?: { payload?: unknown } };
    if (data.plugin !== 'rrweb/console@1') continue;
    // Start-anchored: the producer emits the prefix at the very start of the
    // line, so a mid-string match would only be a false positive.
    const line = consoleArgString(data.payload?.payload);
    if (!line.startsWith(SEC_CONSOLE_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(SEC_CONSOLE_PREFIX.length).trim());
      if (isResponseMeta(parsed)) out.push(parsed);
    } catch {
      /* malformed — skip */
    }
  }
  return out;
}
