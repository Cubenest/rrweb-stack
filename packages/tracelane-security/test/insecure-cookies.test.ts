import { describe, expect, it } from 'vitest';
import { detectInsecureCookies } from '../src/detectors/insecure-cookies.js';
import type { ResponseMeta } from '../src/response-meta.js';

const withCookies = (setCookies: ResponseMeta['setCookies']): ResponseMeta => ({
  url: 'https://app.test/',
  status: 200,
  isMainDocument: true,
  presentSecurityHeaders: [],
  setCookies,
});

describe('detectInsecureCookies', () => {
  it('flags a cookie missing Secure (medium) and SameSite (low)', () => {
    const f = detectInsecureCookies([
      withCookies([{ name: 'sid', secure: false, httpOnly: true, sameSite: false }]),
    ]);
    expect(f.find((x) => x.evidence === 'sid:Secure')?.severity).toBe('medium');
    expect(f.find((x) => x.evidence === 'sid:SameSite')?.severity).toBe('low');
    expect(f.find((x) => x.evidence === 'sid:HttpOnly')).toBeUndefined();
  });
  it('no finding for a fully-flagged cookie', () => {
    expect(
      detectInsecureCookies([
        withCookies([{ name: 'sid', secure: true, httpOnly: true, sameSite: true }]),
      ]),
    ).toEqual([]);
  });
  it('emits three findings for a cookie missing all flags', () => {
    const f = detectInsecureCookies([
      withCookies([{ name: 'sid', secure: false, httpOnly: false, sameSite: false }]),
    ]);
    expect(f.map((x) => x.evidence).sort()).toEqual(['sid:HttpOnly', 'sid:SameSite', 'sid:Secure']);
    expect(f.find((x) => x.evidence === 'sid:HttpOnly')?.severity).toBe('low');
  });
  it('dedupes the same insecure cookie flag across multiple responses', () => {
    const meta = withCookies([{ name: 'sid', secure: false, httpOnly: true, sameSite: true }]);
    expect(detectInsecureCookies([meta, meta])).toHaveLength(1);
  });
});
