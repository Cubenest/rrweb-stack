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
});
