import { describe, expect, it } from 'vitest';
import { detectMissingHeaders } from '../src/detectors/missing-headers.js';
import type { ResponseMeta } from '../src/response-meta.js';

const mainDoc = (present: string[], url = 'https://app.test/'): ResponseMeta => ({
  url,
  status: 200,
  isMainDocument: true,
  presentSecurityHeaders: present,
  setCookies: [],
});

describe('detectMissingHeaders', () => {
  it('flags each absent allowlisted header on an HTTPS main doc', () => {
    const evidence = detectMissingHeaders([mainDoc(['content-security-policy'])]).map(
      (x) => x.evidence,
    );
    expect(evidence).toContain('strict-transport-security');
    expect(evidence).not.toContain('content-security-policy'); // present → not flagged
  });
  it('CSP missing is high severity', () => {
    expect(
      detectMissingHeaders([mainDoc([])]).find((x) => x.evidence === 'content-security-policy')
        ?.severity,
    ).toBe('high');
  });
  it('skips entirely when the main doc is not HTTPS', () => {
    expect(detectMissingHeaders([mainDoc([], 'http://localhost:3000/')])).toEqual([]);
  });
  it('returns nothing when there is no main-document meta', () => {
    expect(detectMissingHeaders([])).toEqual([]);
  });
  it('flags all five allowlisted headers when none are present', () => {
    expect(detectMissingHeaders([mainDoc([])])).toHaveLength(5);
  });
});
