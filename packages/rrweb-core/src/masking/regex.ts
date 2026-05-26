// PII regex bank. Internal — not part of the public API surface.
//
// Each pattern is intentionally conservative to limit false positives;
// callers route matches through type-tagged tokens (`<<REDACTED:CC>>` etc).
// Known caveats are documented inline alongside each pattern.
//
// All `g` (global) patterns are stateful via lastIndex; helpers reset before
// use. Treat these as read-only constants.

/**
 * Email — RFC 5322 "lite". Matches the overwhelming majority of real-world
 * addresses without trying to model the full grammar (which permits quoted
 * locals and comments most senders never use).
 *
 * Quantifier caps (`{1,64}`/`{1,255}`/`{2,24}`) are intentional: the spec
 * lets local-parts run to 64 chars and the full address to 254, so the
 * caps are not under-matching real addresses. They DO bound backtracking
 * cost — unbounded `+` here is catastrophic on large no-`@` inputs (a
 * megabyte of `a`s would quadratically backtrack at every start position).
 *
 * False-positive surface: strings like `a@b.co` where the TLD is short
 * will match. Acceptable — we'd rather over-redact emails.
 */
export const EMAIL_REGEX = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;

/**
 * US Social Security Number — `NNN-NN-NNNN`. We intentionally require the
 * dashes; the dash-less 9-digit form collides with too many legitimate
 * identifiers (order numbers, zip+4, etc).
 */
export const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * Credit-card candidate — 13-19 contiguous digits with optional separators
 * (spaces or dashes). Match alone is NOT enough; callers MUST pass each
 * match through {@link luhn} before treating it as a real card number.
 *
 * Prefixes we expect to catch (validated by Luhn after the fact):
 *   Visa       4xxx
 *   Mastercard 5xxx, 2221-2720
 *   Amex       34xx, 37xx (15 digits)
 *   Discover   6011, 65, 644-649 (16 digits)
 *
 * The `(?:[ -]?\d){12,18}` shape is anchored on a leading digit and only
 * matches 13-19 total digits — bounded width means linear-time matching.
 *
 * False-positive surface without Luhn: phone numbers, account numbers,
 * arbitrary 16-digit strings. Luhn cuts that to near-zero.
 */
export const CREDIT_CARD_REGEX = /\b\d(?:[ -]?\d){12,18}\b/g;

/**
 * Phone — international-ish (E.164-friendly). Permissive on separators.
 *
 * False-positive surface: large numeric runs with separators (e.g. some
 * timestamps, account numbers with dashes). We accept this; callers route
 * to `<<REDACTED:PHONE>>` so the AI consumer knows the redaction type and
 * can choose to ignore it if context suggests not-a-phone.
 */
export const PHONE_REGEX = /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;

/**
 * JWT — three base64url segments separated by `.`. The 10-char minimum on
 * each segment screens out very short look-alikes (e.g. `eyJ.a.b`).
 * Upper bound of 4096 per segment is generous (RFC 7519 doesn't set one;
 * real-world JWTs rarely exceed ~2 KB total) and keeps the regex linear.
 */
export const JWT_REGEX =
  /eyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/g;

/**
 * Stripe secret/publishable keys — `sk_live_*`, `sk_test_*`, `pk_live_*`,
 * `pk_test_*` with 24-128 chars of payload (real keys are ~99 chars but
 * the cap protects against pathological inputs).
 */
export const STRIPE_KEY_REGEX = /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,128}\b/g;

/**
 * GitHub personal-access tokens — `ghp_` prefix + 36 chars.
 */
export const GITHUB_TOKEN_REGEX = /\bghp_[A-Za-z0-9]{36}\b/g;

/**
 * AWS access key IDs — `AKIA` prefix + 16 uppercase-alnum chars.
 */
export const AWS_ACCESS_KEY_REGEX = /\bAKIA[0-9A-Z]{16}\b/g;

/**
 * PEM blocks — anything between `-----BEGIN ...-----` and `-----END ...-----`.
 * Non-greedy so multiple blocks in one string don't merge. The `{1,64}`
 * label cap matches what OpenSSL emits; the `{1,131072}` body cap is the
 * widest realistic PEM (~96 KB for an 8192-bit RSA key with armor).
 */
export const PEM_BLOCK_REGEX =
  /-----BEGIN [A-Z ]{1,64}-----[\s\S]{1,131072}?-----END [A-Z ]{1,64}-----/g;

/**
 * Luhn check (mod-10). Accepts a digit string with optional spaces/dashes;
 * returns true iff the cleaned digit run is 13-19 chars and passes the
 * checksum. Used to confirm a {@link CREDIT_CARD_REGEX} match before
 * tagging as a credit card.
 */
export function luhn(candidate: string): boolean {
  const digits = candidate.replace(/[\s-]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  if (!/^\d+$/.test(digits)) return false;

  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48; // '0' = 48
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Token tags emitted by {@link applyRegexBank}. Exposed for tests; not
 * re-exported from the public barrel.
 */
export type RedactionTag =
  | 'CC'
  | 'SSN'
  | 'EMAIL'
  | 'PHONE'
  | 'JWT'
  | 'STRIPE_KEY'
  | 'GITHUB_TOKEN'
  | 'AWS_KEY'
  | 'PEM';

const TOKEN = (tag: RedactionTag): string => `<<REDACTED:${tag}>>`;

/**
 * Order matters: high-specificity patterns first so they win when a string
 * could match multiple banks (e.g. a Stripe key looks like a generic alnum
 * blob; PEM bodies might contain base64 chunks that resemble JWT halves).
 *
 * Credit cards are handled separately because they need Luhn validation.
 */
const ORDERED_PATTERNS: Array<{ tag: RedactionTag; re: RegExp }> = [
  { tag: 'PEM', re: PEM_BLOCK_REGEX },
  { tag: 'JWT', re: JWT_REGEX },
  { tag: 'STRIPE_KEY', re: STRIPE_KEY_REGEX },
  { tag: 'GITHUB_TOKEN', re: GITHUB_TOKEN_REGEX },
  { tag: 'AWS_KEY', re: AWS_ACCESS_KEY_REGEX },
  { tag: 'EMAIL', re: EMAIL_REGEX },
  { tag: 'SSN', re: SSN_REGEX },
  // Phone is intentionally last among the non-CC banks: it's the most
  // false-positive-prone, so any prior bank that matched the same span
  // should claim it first.
  { tag: 'PHONE', re: PHONE_REGEX },
];

/**
 * Apply the regex bank to `input`, returning the redacted string.
 * Credit cards are handled in a separate Luhn-validated pass.
 *
 * Internal — exposed via `redactBody` and `maskTextContent` only.
 */
export function applyRegexBank(input: string): string {
  if (input.length === 0) return input;

  let out = input;

  // Pass 1: Luhn-validated credit cards. We replace match-by-match so we
  // don't redact strings that look like CCs but fail the checksum.
  out = replaceWithValidator(out, CREDIT_CARD_REGEX, (m) => (luhn(m) ? TOKEN('CC') : null));

  // Pass 2: the remaining ordered patterns. Each pattern runs against
  // whatever's left after the prior passes, so tokens like
  // `<<REDACTED:CC>>` won't be re-matched.
  for (const { tag, re } of ORDERED_PATTERNS) {
    // Fresh regex per pass to keep `lastIndex` clean.
    const fresh = new RegExp(re.source, re.flags);
    out = out.replace(fresh, TOKEN(tag));
  }

  return out;
}

/**
 * Like `String.prototype.replace(re, fn)` but lets the callback return
 * `null` to skip the replacement (leave the original substring in place).
 * Used for Luhn-gated credit-card redaction.
 */
function replaceWithValidator(
  input: string,
  re: RegExp,
  fn: (match: string) => string | null,
): string {
  const fresh = new RegExp(re.source, re.flags);
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null = fresh.exec(input);
  while (match !== null) {
    const replacement = fn(match[0]);
    if (replacement !== null) {
      result += input.slice(lastIndex, match.index) + replacement;
      lastIndex = match.index + match[0].length;
    }
    // If validator rejected, leave the substring; advance past it so the
    // regex doesn't re-match in place.
    if (fresh.lastIndex === match.index) fresh.lastIndex++;
    match = fresh.exec(input);
  }
  result += input.slice(lastIndex);
  return result;
}
