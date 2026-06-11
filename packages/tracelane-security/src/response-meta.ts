import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { SEC_EVENT_TAG } from './index.js';

/**
 * Privacy-safe response metadata recovered from a `tracelane.sec` Custom event.
 * Carries only header NAMES (never values), per-cookie flag presence
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
 * Full structural validation of a `tracelane.sec` Custom-event payload, including
 * array ELEMENT types. A page can't forge a Node-side Custom event, but a
 * shape-malformed object (e.g. `presentSecurityHeaders: [123]` or
 * `setCookies: [{}]`) must still be rejected to honor the "malformed payloads
 * are skipped" contract and protect downstream consumers from runtime errors.
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
 * Read privacy-safe response metadata out of the rrweb Custom events the
 * capture layer injects (tag `tracelane.sec`, payload = the meta object).
 * Replaces the old console-scrape channel, which raced navigation. Malformed
 * payloads are skipped.
 */
export function scrapeResponseMeta(events: readonly eventWithTime[]): ResponseMeta[] {
  const out: ResponseMeta[] = [];
  for (const e of events) {
    if (e.type !== EventType.Custom) continue;
    const data = e.data as { tag?: unknown; payload?: unknown };
    if (data.tag !== SEC_EVENT_TAG) continue;
    if (isResponseMeta(data.payload)) out.push(data.payload);
  }
  return out;
}
