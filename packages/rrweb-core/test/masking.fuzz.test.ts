// @vitest-environment jsdom
// Property-based fuzz suite for the PII redaction bank.
//
// WHY THIS FILE EXISTS
// --------------------
// `redactBody` / `maskTextContent` / `applyRegexBank` ingest arbitrary,
// attacker-influenced strings (network bodies, text-node content) and run them
// through a bank of global regexes plus a hand-rolled `lastIndex`-advancing
// replace loop (`replaceWithValidator` in src/masking/regex.ts). That shape is
// the classic home of ReDoS, non-termination, and "redaction silently leaks
// the secret it was supposed to remove" regressions. The example-based unit
// tests in masking.test.ts cover the happy path; this file generates thousands
// of adversarial inputs and asserts INVARIANTS that must hold for EVERY input:
//
//   1. Total functions: redactBody / maskTextContent / applyRegexBank never
//      throw and always terminate (a genuine ReDoS shows up as a vitest
//      timeout rather than a multi-minute hang).
//   2. No secret survives: a Luhn-valid card embedded in random noise must not
//      appear verbatim in the redacted output (catches a regex a refactor
//      accidentally weakens).
//   3. Truncation honoured: inputs longer than the cap carry the truncation
//      marker with the dropped count; shorter inputs do not.
//
// We deliberately do NOT assert idempotency: the existing implementation makes
// no idempotency guarantee, so asserting it would risk a flaky CI gate rather
// than testing a real contract.
//
// The `@vitest-environment jsdom` pragma matches masking.test.ts — the
// repo-root `pnpm test` runs `vitest run` without a config file, and the
// masking import chain references DOM globals, so jsdom is required.
//
// DETECTION NOTE: OpenSSF Scorecard's Fuzzing check (checks/raw/fuzzing.go)
// greps committed *.ts/*.tsx files for `from 'fast-check'`. The import below
// is what flips the Fuzzing check from 0 to 10. fast-check is runner-agnostic;
// `fc.assert(fc.property(...))` runs inside vitest with no extra config, so
// `pnpm test` exercises these properties in CI on every PR and push.

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { maskTextContent, redactBody } from '../src/masking';
import { applyRegexBank, luhn } from '../src/masking/regex';

// Cap generated input length so a property run stays well under vitest's 5 s
// default per-test timeout and a genuine ReDoS surfaces as a timeout, not a
// multi-minute hang. 2 KB is far past every regex's bounded-width quantifiers.
const body = fc.string({ maxLength: 2048 });

describe('redaction bank — fuzz invariants', () => {
  test('redactBody never throws and always returns a string', () => {
    fc.assert(
      fc.property(body, (s) => typeof redactBody(s) === 'string'),
      { numRuns: 500 },
    );
  });

  test('maskTextContent never throws and always returns a string', () => {
    fc.assert(
      fc.property(body, (s) => typeof maskTextContent(s) === 'string'),
      { numRuns: 500 },
    );
  });

  test('applyRegexBank never throws and always returns a string', () => {
    fc.assert(
      fc.property(body, (s) => typeof applyRegexBank(s) === 'string'),
      { numRuns: 500 },
    );
  });

  test('a Luhn-valid card embedded in random noise never survives redaction', () => {
    // 4111111111111111 is a canonical Luhn-valid Visa test number.
    const card = '4111111111111111';
    expect(luhn(card)).toBe(true);
    fc.assert(
      fc.property(fc.string({ maxLength: 256 }), fc.string({ maxLength: 256 }), (pre, post) => {
        // Spaces isolate the card so digits in pre/post can't fuse onto it and
        // push its length out of the 13-19 digit window.
        const haystack = `${pre} ${card} ${post}`;
        expect(maskTextContent(haystack).includes(card)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  test('redactBody respects the length cap and appends the truncation suffix', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 2048 }),
        fc.integer({ min: 1, max: 512 }),
        (s, max) => {
          const out = redactBody(s, { maxLengthBytes: max });
          // redactBody caps on String#length (UTF-16 code units), matching the
          // implementation in src/masking/body.ts.
          if (s.length <= max) {
            return !out.includes('[TRUNCATED');
          }
          return out.includes(`[TRUNCATED ${s.length - max} more bytes]`);
        },
      ),
      { numRuns: 500 },
    );
  });
});
