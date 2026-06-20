/**
 * The privacy boundary (ADR-0002, threat model §H1): masking applied in the
 * ISOLATED world BEFORE anything is forwarded to the SW / persisted.
 *
 * The MAIN-world recorder captures network headers/bodies RAW (it has no
 * `chrome.*` and no masking primitives, and we keep its footprint minimal so
 * the page can't subvert it). The ISOLATED relay is the trusted seam that runs
 * @cubenest/rrweb-core's masking primitives over every record before it leaves
 * the content script:
 *
 *   - network headers  → `redactNetworkHeaders` (Authorization/Cookie/… deny-list)
 *   - network bodies   → `redactBody` (Luhn CC / SSN / JWT / API-key / email / …)
 *   - console arg text → `maskTextContent` (same PII regex bank)
 *
 * rrweb DOM input/text masking is done by the recorder itself at capture time
 * (the PostHog fork's `maskInputOptions` / `maskTextSelector`); we do NOT
 * re-walk arbitrary rrweb event trees here (fragile, and would double-mask).
 * This module's job is the network + console surface the monkey-patch produces.
 *
 * All pure: string/record in, string/record out, no DOM, no `chrome.*` — so it
 * unit-tests without a browser. This is the most security-sensitive code in the
 * chunk; it is exercised directly by the tests in __tests__/mask.test.ts.
 */

import { maskTextContent, redactBody, redactNetworkHeaders } from '@cubenest/rrweb-core';
import type { NetMessage } from '../recorder/messages.js';
import { maskUrl } from './mask-url.js';

// Re-export so existing consumers of `relay/mask` keep working. The definition
// lives in `./mask-url` (no rrweb-core import) so WXT entrypoints can import it
// without dragging rrweb-core into `wxt prepare`'s transform graph.
export { maskUrl } from './mask-url.js';

/**
 * Redact a network record in place-of (returns a new object). Applies the
 * header deny-list and the body PII regex bank to whichever fields are present.
 * Never throws — a masking failure must not leak the raw record, so on any
 * error we drop the offending field rather than forward it unmasked.
 */
export function maskNetMessage(rec: NetMessage): NetMessage {
  const out: NetMessage = { ...rec };

  if (typeof rec.url === 'string') {
    out.url = maskUrl(rec.url);
  }

  if (rec.headers) {
    try {
      out.headers = redactNetworkHeaders(rec.headers);
    } catch {
      // Fail closed: if redaction throws, forward NO headers rather than raw.
      out.headers = {};
    }
  }

  if (typeof rec.requestBody === 'string') {
    out.requestBody = safeRedactBody(rec.requestBody);
  }
  if (typeof rec.responseBody === 'string') {
    out.responseBody = safeRedactBody(rec.responseBody);
  }

  return out;
}

/** Run `redactBody`, failing closed to a marker rather than leaking raw text. */
function safeRedactBody(body: string): string {
  try {
    return redactBody(body);
  } catch {
    return '<<REDACTION_ERROR>>';
  }
}

/**
 * Mask the stringified args of a console event (defense-in-depth: app logs
 * frequently contain tokens, emails, and ids). Operates on the `args: string[]`
 * shape our `ConsoleEvent` / the rrweb console plugin produces.
 */
export function maskConsoleArgs(args: readonly string[]): string[] {
  return args.map((a) => {
    try {
      return maskTextContent(a);
    } catch {
      return '<<REDACTION_ERROR>>';
    }
  });
}
