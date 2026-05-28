import { buildManifest } from '@peekdev/mcp/native-host';
import { describe, expect, it } from 'vitest';
import {
  chromeExtensionOrigin,
  extractDevId,
  validateChromeExtensionId,
} from '../src/lib/extension-id.js';

// P-10 (2026-05-28 QA walk): the wizard now captures the unpacked-extension
// ID and overrides extensionIds.dev before buildManifest is called. These
// tests pin the input validator and the buildManifest override semantics —
// the prompt I/O itself (promptText readline loop) is exercised manually.

describe('validateChromeExtensionId — input shape', () => {
  it('accepts a well-formed 32-char a–p ID (lowercase only)', () => {
    expect(validateChromeExtensionId('abcdefghijklmnopabcdefghijklmnop')).toBeNull();
    expect(validateChromeExtensionId('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(validateChromeExtensionId('pppppppppppppppppppppppppppppppp')).toBeNull();
  });

  it('trims surrounding whitespace before validating (paste-from-chrome case)', () => {
    expect(validateChromeExtensionId('  abcdefghijklmnopabcdefghijklmnop  ')).toBeNull();
    expect(validateChromeExtensionId('\nabcdefghijklmnopabcdefghijklmnop\n')).toBeNull();
  });

  it('rejects empty input with a clear message', () => {
    expect(validateChromeExtensionId('')).toMatch(/required/i);
    expect(validateChromeExtensionId('   ')).toMatch(/required/i);
  });

  it('rejects wrong-length input with the actual length echoed', () => {
    // 31 chars — typo at copy time.
    const msg31 = validateChromeExtensionId('abcdefghijklmnopabcdefghijklmno');
    expect(msg31).toContain('32-character');
    expect(msg31).toContain('31');
    // 33 chars — accidental trailing copy.
    const msg33 = validateChromeExtensionId('abcdefghijklmnopabcdefghijklmnopa');
    expect(msg33).toContain('32-character');
    expect(msg33).toContain('33');
  });

  it('rejects out-of-alphabet characters (chars after p, digits, uppercase)', () => {
    // 'z' is out of alphabet
    expect(validateChromeExtensionId('zaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.slice(0, 32))).toMatch(
      /a–p/,
    );
    // uppercase
    expect(validateChromeExtensionId('ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP')).toMatch(/a–p/);
    // digits
    expect(validateChromeExtensionId('1234567890abcdefghijklmnopabcdef')).toMatch(/a–p/);
  });

  it('rejects a Web Store-ish ID that has the right length but wrong alphabet', () => {
    // CWS IDs are 32 chars but the alphabet is the same — this tests that an
    // ID containing e.g. 'q' (post-p) is rejected even at correct length.
    expect(validateChromeExtensionId('qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toMatch(/a–p/);
  });
});

describe('chromeExtensionOrigin — origin string', () => {
  it('builds the `chrome-extension://<id>/` origin Chrome expects', () => {
    expect(chromeExtensionOrigin('abcdefghijklmnopabcdefghijklmnop')).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/',
    );
  });
});

describe('extractDevId — P-13 idempotency read-back', () => {
  it('returns the 32-char a–p ID from a valid chrome-extension origin', () => {
    const m = { allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/'] };
    expect(extractDevId(m)).toBe('abcdefghijklmnopabcdefghijklmnop');
  });

  it('picks the first valid ID when multiple origins are present', () => {
    const m = {
      allowed_origins: [
        'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
        'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/',
      ],
    };
    expect(extractDevId(m)).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('returns undefined for empty allowed_origins (the original P-10 bug state)', () => {
    expect(extractDevId({ allowed_origins: [] })).toBeUndefined();
  });

  it('returns undefined when allowed_origins is missing or wrong shape', () => {
    expect(extractDevId({})).toBeUndefined();
    expect(extractDevId({ allowed_origins: null })).toBeUndefined();
    expect(extractDevId({ allowed_origins: 'chrome-extension://abc/' })).toBeUndefined();
  });

  it('returns undefined for non-objects (null, undefined, primitives, arrays)', () => {
    expect(extractDevId(null)).toBeUndefined();
    expect(extractDevId(undefined)).toBeUndefined();
    expect(extractDevId('not an object')).toBeUndefined();
    expect(extractDevId(42)).toBeUndefined();
    expect(extractDevId(['arr'])).toBeUndefined();
  });

  it('skips non-string entries in the array', () => {
    const m = {
      allowed_origins: [
        null,
        42,
        { weird: 'object' },
        'chrome-extension://pppppppppppppppppppppppppppppppp/',
      ],
    };
    expect(extractDevId(m)).toBe('pppppppppppppppppppppppppppppppp');
  });

  it('rejects origin strings that do not match the strict pattern', () => {
    // Missing trailing slash
    expect(
      extractDevId({ allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop'] }),
    ).toBeUndefined();
    // Wrong length
    expect(extractDevId({ allowed_origins: ['chrome-extension://shortid/'] })).toBeUndefined();
    // Out-of-alphabet character
    expect(
      extractDevId({ allowed_origins: ['chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/'] }),
    ).toBeUndefined();
    // Uppercase
    expect(
      extractDevId({ allowed_origins: ['chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP/'] }),
    ).toBeUndefined();
  });
});

describe('buildManifest with extensionIds.dev override (P-10 fix)', () => {
  const placeholderIds = {
    chromeWebStore: 'PLACEHOLDER_CHROME_WEB_STORE_ID',
    edgeAddons: 'PLACEHOLDER_EDGE_ADDONS_ID',
    dev: 'PLACEHOLDER_DEV_UNPACKED_ID',
  };

  it('returns empty allowed_origins when all three slots are placeholders (the bug)', () => {
    // Reproduces the pre-fix state: nothing usable to populate allowed_origins.
    const manifest = buildManifest('/opt/peek-mcp/dist/index.js', placeholderIds);
    expect(manifest.allowed_origins).toEqual([]);
  });

  it('overriding dev with a captured ID populates allowed_origins with that origin', () => {
    const captured = 'abcdefghijklmnopabcdefghijklmnop';
    // Simulates the wizard's override step.
    const overridden = { ...placeholderIds, dev: captured };
    const manifest = buildManifest('/opt/peek-mcp/dist/index.js', overridden);
    expect(manifest.allowed_origins).toEqual([`chrome-extension://${captured}/`]);
  });

  it('preserves non-placeholder published IDs alongside a captured dev ID', () => {
    const cws = 'cwsidcwsidcwsidcwsidcwsidcwsidcw';
    const captured = 'abcdefghijklmnopabcdefghijklmnop';
    const ids = { ...placeholderIds, chromeWebStore: cws, dev: captured };
    const manifest = buildManifest('/opt/peek-mcp/dist/index.js', ids);
    // Both origins land in allowed_origins; CWS first per the source order in
    // allowedOrigins() (chromeWebStore, edgeAddons, dev).
    expect(manifest.allowed_origins).toEqual([
      `chrome-extension://${cws}/`,
      `chrome-extension://${captured}/`,
    ]);
  });
});
