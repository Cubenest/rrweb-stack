// Network header redaction. Case-insensitive deny-list per
// IMPLEMENTATION_PLAN.md Task 1.3 and P2 PRD §D.2.

/**
 * Headers always redacted, regardless of casing. Lowercased here so
 * comparisons can be a single `.toLowerCase()` on the caller side.
 *
 * Per plan: `authorization`, `cookie`, `set-cookie`, `x-api-key`,
 * `x-csrf-token`, `x-real-ip`, `proxy-authorization`.
 */
const DENY_LIST: ReadonlySet<string> = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-csrf-token',
  'x-real-ip',
  'proxy-authorization',
]);

const REDACTED_VALUE = '<<REDACTED>>';

/**
 * Redact sensitive headers in place-of in a record. Input is a plain
 * `Record<string, string>` (the lowest common denominator between fetch
 * `Headers`, Node's `IncomingMessage.headers`, and webRequest's
 * `chrome.webRequest.HttpHeader[]` after normalization).
 *
 * Non-deny-list headers are returned unchanged. Header *names* are
 * preserved with their original casing; only *values* on the deny-list
 * are replaced with `<<REDACTED>>`.
 *
 * @example
 *   redactNetworkHeaders({ Authorization: 'Bearer abc', Accept: 'json' })
 *   // -> { Authorization: '<<REDACTED>>', Accept: 'json' }
 */
export function redactNetworkHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (DENY_LIST.has(name.toLowerCase())) {
      out[name] = REDACTED_VALUE;
    } else {
      out[name] = value;
    }
  }
  return out;
}
