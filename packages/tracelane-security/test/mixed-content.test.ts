import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { detectMixedContent } from '../src/detectors/mixed-content.js';
import type { ResponseMeta } from '../src/response-meta.js';

// rrweb serialized element node: type 2 = Element.
function el(tagName: string, attributes: Record<string, string>, id = 1) {
  return { type: 2, tagName, attributes, childNodes: [], id };
}
function fullSnapshot(nodes: unknown[]): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    timestamp: 0,
    data: { node: { type: 0, childNodes: nodes, id: 0 } },
  } as unknown as eventWithTime;
}

const mainMeta = (url: string): ResponseMeta => ({
  url,
  status: 200,
  isMainDocument: true,
  presentSecurityHeaders: [],
  setCookies: [],
});

const HTTPS_MAIN = [mainMeta('https://app.test/')];

describe('detectMixedContent', () => {
  it('flags an http src on an https page (high), evidence the url', () => {
    const f = detectMixedContent(
      [fullSnapshot([el('img', { src: 'http://cdn.test/a.png' })])],
      HTTPS_MAIN,
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('high');
    expect(f[0]?.signal).toBe('mixed-content');
    expect(f[0]?.evidence).toBe('http://cdn.test/a.png');
  });

  it('no finding when the resource is https', () => {
    expect(
      detectMixedContent(
        [fullSnapshot([el('script', { src: 'https://cdn.test/a.js' })])],
        HTTPS_MAIN,
      ),
    ).toEqual([]);
  });

  it('no finding when the main doc is not https', () => {
    expect(
      detectMixedContent(
        [fullSnapshot([el('img', { src: 'http://cdn/a.png' })])],
        [mainMeta('http://localhost/')],
      ),
    ).toEqual([]);
  });

  it('returns nothing when there is no main-document meta', () => {
    expect(
      detectMixedContent([fullSnapshot([el('img', { src: 'http://cdn/a.png' })])], []),
    ).toEqual([]);
  });

  it('does NOT flag an http anchor href (navigation, not a subresource)', () => {
    expect(
      detectMixedContent([fullSnapshot([el('a', { href: 'http://x.test' })])], HTTPS_MAIN),
    ).toEqual([]);
  });

  it('flags an http href on a <link> (stylesheet/preload)', () => {
    const f = detectMixedContent(
      [fullSnapshot([el('link', { rel: 'stylesheet', href: 'http://cdn/s.css' })])],
      HTTPS_MAIN,
    );
    expect(f).toHaveLength(1);
    expect(f[0]?.evidence).toBe('http://cdn/s.css');
  });

  it('dedupes the same http src', () => {
    const node = el('img', { src: 'http://cdn/a.png' });
    expect(detectMixedContent([fullSnapshot([node, node])], HTTPS_MAIN)).toHaveLength(1);
  });

  it('finds resources nested deep in the tree', () => {
    const deep = {
      type: 2,
      tagName: 'div',
      attributes: {},
      id: 9,
      childNodes: [el('iframe', { src: 'http://cdn/frame' }, 2)],
    };
    expect(detectMixedContent([fullSnapshot([deep])], HTTPS_MAIN)).toHaveLength(1);
  });
});
