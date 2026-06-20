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

/**
 * Redact query-PARAMETER VALUES while keeping the path + which params existed
 * (review issue 2). URLs routinely carry secrets in the query string
 * (`?access_token=sk-live-…`, `?api_key=`, `?token=`, `?session=`). Keeping the
 * keys + path preserves debugging value ("which params were sent") without
 * leaking the secret. Fails closed: if the URL won't parse, drop the query
 * entirely rather than forward it raw.
 *
 * Exported so the SW's R2 `element_detail` branch path-masks an element's `href`
 * with the SAME scheme peek uses for network URLs (one masking definition, not a
 * parallel one that could drift).
 */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      u.searchParams.set(key, '<<REDACTED>>');
    }
    return u.href;
  } catch {
    // Unparseable (relative URL, malformed) — strip the query to be safe.
    const q = url.indexOf('?');
    return q === -1 ? url : url.slice(0, q);
  }
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
