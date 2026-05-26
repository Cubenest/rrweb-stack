// Masking primitives — Task 1.3 test suite.
// Covers positive matches, negative matches, Luhn validation, hard-mask
// inputs, header case-insensitivity, body truncation, and COMPAT_SELECTORS
// shape.

import { describe, expect, test } from 'vitest';
import {
  COMPAT_SELECTORS,
  maskInputValue,
  maskTextContent,
  redactBody,
  redactNetworkHeaders,
} from '../src/masking';
import { luhn } from '../src/masking/regex';

// ────────────────────────────────────────────────────────────────
// Regex bank — positive matches (one fixture per pattern).
// ────────────────────────────────────────────────────────────────

describe('regex bank — positive matches', () => {
  test('redacts an email address', () => {
    expect(maskTextContent('contact alice@example.com today')).toBe(
      'contact <<REDACTED:EMAIL>> today',
    );
  });

  test('redacts a US SSN', () => {
    expect(maskTextContent('SSN: 123-45-6789.')).toBe('SSN: <<REDACTED:SSN>>.');
  });

  test('redacts a Luhn-valid Visa test card', () => {
    expect(maskTextContent('card 4111 1111 1111 1111 paid')).toBe('card <<REDACTED:CC>> paid');
  });

  test('redacts a Luhn-valid Mastercard test card', () => {
    expect(maskTextContent('5555555555554444')).toBe('<<REDACTED:CC>>');
  });

  test('redacts a Luhn-valid Amex test card (15 digits)', () => {
    expect(maskTextContent('378282246310005')).toBe('<<REDACTED:CC>>');
  });

  test('redacts a Luhn-valid Discover test card', () => {
    expect(maskTextContent('6011111111111117')).toBe('<<REDACTED:CC>>');
  });

  test('redacts a phone number with country code', () => {
    expect(maskTextContent('call +1 415-555-0132 now')).toBe('call <<REDACTED:PHONE>> now');
  });

  test('redacts a JWT token', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(maskTextContent(`token=${jwt}`)).toBe('token=<<REDACTED:JWT>>');
  });

  test('redacts a Stripe live secret key', () => {
    expect(maskTextContent('STRIPE=sk_live_abcdefghijklmnopqrstuvwx')).toBe(
      'STRIPE=<<REDACTED:STRIPE_KEY>>',
    );
  });

  test('redacts a Stripe test publishable key', () => {
    expect(maskTextContent('pk_test_abcdefghijklmnopqrstuvwx end')).toBe(
      '<<REDACTED:STRIPE_KEY>> end',
    );
  });

  test('redacts a GitHub personal-access token', () => {
    expect(maskTextContent('GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(
      'GH_TOKEN=<<REDACTED:GITHUB_TOKEN>>',
    );
  });

  test('redacts an AWS access key ID', () => {
    expect(maskTextContent('AKIAIOSFODNN7EXAMPLE')).toBe('<<REDACTED:AWS_KEY>>');
  });

  test('redacts a PEM block', () => {
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQ\n-----END PRIVATE KEY-----';
    expect(maskTextContent(`before ${pem} after`)).toBe('before <<REDACTED:PEM>> after');
  });
});

// ────────────────────────────────────────────────────────────────
// Regex bank — negative matches (must NOT false-positive).
// ────────────────────────────────────────────────────────────────

describe('regex bank — negative matches', () => {
  test('does not treat a non-Luhn 16-digit string as a credit card', () => {
    // 1234567890123456 fails Luhn (checksum sums to 64); the regex still
    // matches the digit run but Luhn rejects it, so the CC tag must NOT
    // appear. The phone bank may still claim the digit run as a phone
    // number — that's the documented false-positive surface for phone,
    // and not what this test is asserting.
    //
    // Some "obvious" fixtures like 1111...1117 actually pass Luhn —
    // picking a fixture that genuinely fails is part of the test.
    expect(maskTextContent('1234567890123456')).not.toContain('REDACTED:CC');
  });

  test('does not redact a plain 9-digit number as an SSN (dashes required)', () => {
    expect(maskTextContent('order 123456789 shipped')).not.toContain('REDACTED:SSN');
  });

  test('does not redact a non-credit-card SSN-shaped string as CC', () => {
    // 123-45-6789 is 9 digits — too short for a CC; Luhn cap prevents this.
    expect(maskTextContent('123-45-6789')).toBe('<<REDACTED:SSN>>');
  });

  test('does not redact a token starting with eyJ but too short for JWT', () => {
    expect(maskTextContent('eyJ.short.bits')).not.toContain('REDACTED:JWT');
  });

  test('does not redact a generic alnum string as a Stripe key', () => {
    expect(maskTextContent('hello_world_this_is_just_normal_text_oneword')).not.toContain(
      'REDACTED:STRIPE_KEY',
    );
  });

  test('does not redact `AKIA` followed by mixed case as an AWS key', () => {
    // AWS keys are uppercase-alnum only; lowercase chars break the match.
    expect(maskTextContent('AKIAabcd0123456789ZZ')).not.toContain('REDACTED:AWS_KEY');
  });

  test('does not redact a GitHub-shaped string with wrong length', () => {
    expect(maskTextContent('ghp_tooShort')).not.toContain('REDACTED:GITHUB_TOKEN');
  });

  test('does not redact a sentence without any PII', () => {
    const s = 'the quick brown fox jumps over the lazy dog';
    expect(maskTextContent(s)).toBe(s);
  });

  test('does not modify an empty string', () => {
    expect(maskTextContent('')).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────
// Luhn — explicit unit tests.
// ────────────────────────────────────────────────────────────────

describe('luhn validator', () => {
  test('accepts Visa test card 4111111111111111', () => {
    expect(luhn('4111111111111111')).toBe(true);
  });

  test('rejects off-by-one 4111111111111112', () => {
    expect(luhn('4111111111111112')).toBe(false);
  });

  test('accepts Amex test card 378282246310005 (15 digits)', () => {
    expect(luhn('378282246310005')).toBe(true);
  });

  test('accepts when dashes/spaces are present', () => {
    expect(luhn('4111-1111-1111-1111')).toBe(true);
    expect(luhn('4111 1111 1111 1111')).toBe(true);
  });

  test('rejects strings under 13 digits', () => {
    expect(luhn('411111111111')).toBe(false); // 12 digits
  });

  test('rejects strings over 19 digits', () => {
    expect(luhn('41111111111111111111')).toBe(false); // 20 digits
  });

  test('rejects strings with non-digit characters', () => {
    expect(luhn('4111111111111abc')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
// maskInputValue — hard-mask types and class-based masking.
// ────────────────────────────────────────────────────────────────

describe('maskInputValue', () => {
  function makeInput(type: string, value: string, className = ''): HTMLInputElement {
    const el = document.createElement('input');
    el.type = type;
    el.value = value;
    if (className.length > 0) el.className = className;
    return el;
  }

  test('hard-masks password inputs regardless of class', () => {
    const el = makeInput('password', 'hunter2');
    expect(maskInputValue(el)).toBe('*******');
  });

  test('hard-masks email inputs regardless of class', () => {
    const el = makeInput('email', 'alice@example.com');
    expect(maskInputValue(el)).toBe('*'.repeat('alice@example.com'.length));
  });

  test('hard-masks tel inputs regardless of class', () => {
    const el = makeInput('tel', '+14155550132');
    expect(maskInputValue(el)).toBe('*'.repeat('+14155550132'.length));
  });

  test('returns the actual value for a plain text input', () => {
    const el = makeInput('text', 'hello world');
    expect(maskInputValue(el)).toBe('hello world');
  });

  test('masks a text input that carries the cubenest-mask class', () => {
    const el = makeInput('text', 'secret', 'cubenest-mask');
    expect(maskInputValue(el)).toBe('******');
  });

  test('masks a text input that carries the ph-no-capture class', () => {
    const el = makeInput('text', 'token', 'ph-no-capture');
    expect(maskInputValue(el)).toBe('*****');
  });

  test('masks a text input whose ancestor carries sentry-mask', () => {
    const wrap = document.createElement('div');
    wrap.className = 'sentry-mask';
    const el = makeInput('text', 'inner');
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    try {
      expect(maskInputValue(el)).toBe('*****');
    } finally {
      wrap.remove();
    }
  });

  test('masks an input under a data-dd-privacy="mask" ancestor', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-dd-privacy', 'mask');
    const el = makeInput('text', 'datadog');
    wrap.appendChild(el);
    document.body.appendChild(wrap);
    try {
      expect(maskInputValue(el)).toBe('*'.repeat('datadog'.length));
    } finally {
      wrap.remove();
    }
  });

  test('masks an input with data-cubenest-mask attribute', () => {
    const el = makeInput('text', 'attr');
    el.setAttribute('data-cubenest-mask', '');
    expect(maskInputValue(el)).toBe('****');
  });

  test('masks textarea content under a mask class', () => {
    const el = document.createElement('textarea');
    el.value = 'multi line';
    el.className = 'rr-mask';
    expect(maskInputValue(el)).toBe('*'.repeat('multi line'.length));
  });
});

// ────────────────────────────────────────────────────────────────
// redactNetworkHeaders — case-insensitivity + pass-through.
// ────────────────────────────────────────────────────────────────

describe('redactNetworkHeaders', () => {
  test('redacts Authorization regardless of casing', () => {
    expect(redactNetworkHeaders({ Authorization: 'Bearer abc' })).toEqual({
      Authorization: '<<REDACTED>>',
    });
    expect(redactNetworkHeaders({ AUTHORIZATION: 'Bearer abc' })).toEqual({
      AUTHORIZATION: '<<REDACTED>>',
    });
    expect(redactNetworkHeaders({ authorization: 'Bearer abc' })).toEqual({
      authorization: '<<REDACTED>>',
    });
  });

  test('redacts all deny-list headers', () => {
    const input = {
      cookie: 'a=1',
      'Set-Cookie': 'b=2',
      'X-API-Key': 'k',
      'X-CSRF-Token': 't',
      'X-Real-IP': '1.2.3.4',
      'Proxy-Authorization': 'Basic c',
    };
    const out = redactNetworkHeaders(input);
    expect(Object.values(out).every((v) => v === '<<REDACTED>>')).toBe(true);
  });

  test('passes through non-sensitive headers unchanged', () => {
    expect(
      redactNetworkHeaders({
        'Content-Type': 'application/json',
        Accept: '*/*',
      }),
    ).toEqual({
      'Content-Type': 'application/json',
      Accept: '*/*',
    });
  });

  test('preserves the original casing of header names', () => {
    expect(redactNetworkHeaders({ AuThOrIzAtIoN: 'x' })).toEqual({
      AuThOrIzAtIoN: '<<REDACTED>>',
    });
  });

  test('returns an empty record for an empty input', () => {
    expect(redactNetworkHeaders({})).toEqual({});
  });
});

// ────────────────────────────────────────────────────────────────
// redactBody — regex + truncation.
// ────────────────────────────────────────────────────────────────

describe('redactBody', () => {
  test('redacts PII inside a JSON-ish body string', () => {
    const body = '{"user":"alice@example.com","ssn":"123-45-6789"}';
    const out = redactBody(body);
    expect(out).toContain('<<REDACTED:EMAIL>>');
    expect(out).toContain('<<REDACTED:SSN>>');
    expect(out).not.toContain('alice@example.com');
    expect(out).not.toContain('123-45-6789');
  });

  test('truncates a body longer than maxLengthBytes', () => {
    const oneMiB = 1024 * 1024;
    const body = 'a'.repeat(2 * oneMiB); // 2 MiB
    const out = redactBody(body); // default cap 1 MiB
    expect(out.length).toBeLessThan(2 * oneMiB);
    expect(out).toContain('[TRUNCATED');
    // Dropped bytes = (2 MiB) - (1 MiB) = 1048576.
    expect(out.endsWith(`[TRUNCATED ${oneMiB} more bytes]`)).toBe(true);
  });

  test('respects a custom maxLengthBytes', () => {
    const body = 'x'.repeat(100);
    const out = redactBody(body, { maxLengthBytes: 10 });
    expect(out.startsWith('xxxxxxxxxx')).toBe(true);
    expect(out).toContain('[TRUNCATED 90 more bytes]');
  });

  test('does not truncate when body is at or below the cap', () => {
    const body = 'hello world';
    expect(redactBody(body, { maxLengthBytes: 11 })).toBe('hello world');
  });

  test('returns empty input unchanged', () => {
    expect(redactBody('')).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────
// COMPAT_SELECTORS — shape + immutability.
// ────────────────────────────────────────────────────────────────

describe('COMPAT_SELECTORS', () => {
  test('exposes all five families', () => {
    expect(Object.keys(COMPAT_SELECTORS).sort()).toEqual(
      ['cubenest', 'datadog', 'posthog', 'rrweb', 'sentry'].sort(),
    );
  });

  test('each family exposes block / mask / ignore / dataAttrs', () => {
    for (const family of Object.values(COMPAT_SELECTORS)) {
      expect(typeof family.block).toBe('string');
      expect(typeof family.mask).toBe('string');
      expect(typeof family.ignore).toBe('string');
      expect(Array.isArray(family.dataAttrs)).toBe(true);
    }
  });

  test('cubenest family contains the documented data-attrs', () => {
    expect(COMPAT_SELECTORS.cubenest.dataAttrs).toEqual([
      'data-cubenest-mask',
      'data-cubenest-block',
      'data-cubenest-ignore',
    ]);
  });

  test('top-level object is frozen', () => {
    expect(Object.isFrozen(COMPAT_SELECTORS)).toBe(true);
  });

  test('each family object is frozen', () => {
    for (const family of Object.values(COMPAT_SELECTORS)) {
      expect(Object.isFrozen(family)).toBe(true);
    }
  });

  test('throws (strict) or no-ops (sloppy) on mutation attempt', () => {
    // In strict mode (modules are strict by default), assigning to a frozen
    // property throws TypeError. We accept either behavior — the important
    // bit is that the value doesn't actually change.
    const before = COMPAT_SELECTORS.cubenest.block;
    try {
      // @ts-expect-error — intentional mutation attempt for the assertion.
      COMPAT_SELECTORS.cubenest.block = 'tampered';
    } catch {
      /* expected in strict mode */
    }
    expect(COMPAT_SELECTORS.cubenest.block).toBe(before);
  });
});
