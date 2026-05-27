// Network/payload body redaction.

import { applyRegexBank } from './regex.js';

const DEFAULT_MAX_LENGTH_BYTES = 1024 * 1024; // 1 MB
const TRUNCATION_SUFFIX = (more: number): string => `... [TRUNCATED ${more} more bytes]`;

export interface RedactBodyOptions {
  /**
   * Hard cap on returned body length (post-redaction, pre-truncation
   * suffix). Defaults to 1 MB. Sizes here are JavaScript string lengths
   * (UTF-16 code units), which is a close-enough proxy for transport
   * bytes in this layer; consumers needing exact byte semantics can
   * pre-encode and pass the resulting string.
   */
  maxLengthBytes?: number;
}

/**
 * Redact a network or DOM body string by:
 *   1. Truncating to `maxLengthBytes` if longer (we trim FIRST so the regex
 *      bank never has to scan more than `max` characters — bounds the cost
 *      and prevents worst-case backtracking on huge inputs).
 *   2. Running the (possibly-truncated) prefix through the PII regex bank
 *      (Luhn-validated credit cards, SSNs, JWTs, API keys, email, phone,
 *      PEM blocks).
 *   3. Appending the truncation suffix with the dropped byte count.
 *
 * Caveat: a multi-megabyte PEM block split across the truncation boundary
 * won't be redacted as a PEM. Acceptable — that's already a degenerate
 * input shape and the head/tail markers stay visible enough for human
 * review.
 *
 * Operates purely on strings — no DOM required, no environment coupling.
 * Safe to use in service workers, Node, and tests.
 */
export function redactBody(body: string, opts: RedactBodyOptions = {}): string {
  const max = opts.maxLengthBytes ?? DEFAULT_MAX_LENGTH_BYTES;
  if (body.length === 0) return body;

  if (body.length <= max) return applyRegexBank(body);

  const head = body.slice(0, max);
  const dropped = body.length - max;
  return `${applyRegexBank(head)}${TRUNCATION_SUFFIX(dropped)}`;
}
