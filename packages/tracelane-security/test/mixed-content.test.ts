import { describe, expect, it } from 'vitest';
import { detectMixedContent } from '../src/detectors/mixed-content.js';
import type { ResponseMeta } from '../src/response-meta.js';

const m = (url: string, isMainDocument = false): ResponseMeta => ({
  url,
  status: 200,
  isMainDocument,
  presentSecurityHeaders: [],
  setCookies: [],
});

describe('detectMixedContent', () => {
  it('flags an http subresource on an https page (high)', () => {
    const f = detectMixedContent([m('https://app.test/', true), m('http://cdn.test/a.js')]);
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.evidence).toBe('http://cdn.test/a.js');
  });
  it('no finding when all requests are https', () => {
    expect(detectMixedContent([m('https://app.test/', true), m('https://cdn.test/a.js')])).toEqual(
      [],
    );
  });
  it('no finding when the main doc is not https', () => {
    expect(detectMixedContent([m('http://localhost/', true), m('http://cdn/a.js')])).toEqual([]);
  });
  it('dedupes repeated http urls', () => {
    expect(
      detectMixedContent([
        m('https://app.test/', true),
        m('http://cdn/a.js'),
        m('http://cdn/a.js'),
      ]),
    ).toHaveLength(1);
  });
});
