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
    const line = consoleArgString(data.payload?.payload);
    const idx = line.indexOf(SEC_CONSOLE_PREFIX);
    if (idx === -1) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(idx + SEC_CONSOLE_PREFIX.length).trim());
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as ResponseMeta).url === 'string' &&
        typeof (parsed as ResponseMeta).status === 'number' &&
        typeof (parsed as ResponseMeta).isMainDocument === 'boolean' &&
        Array.isArray((parsed as ResponseMeta).presentSecurityHeaders) &&
        Array.isArray((parsed as ResponseMeta).setCookies)
      ) {
        out.push(parsed as ResponseMeta);
      }
    } catch {
      /* malformed — skip */
    }
  }
  return out;
}
