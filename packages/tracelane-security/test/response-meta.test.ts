import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { scrapeResponseMeta } from '../src/response-meta.js';

// Build a `tracelane.sec` rrweb Custom event the way the capture layer injects it
// (Node-side, payload = the meta object).
function secEvent(meta: unknown, ts = 0): eventWithTime {
  return {
    type: EventType.Custom,
    timestamp: ts,
    data: { tag: 'tracelane.sec', payload: meta },
  } as unknown as eventWithTime;
}

describe('scrapeResponseMeta', () => {
  it('parses tracelane.sec Custom events into ResponseMeta', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: ['content-security-policy'],
      setCookies: [],
    };
    expect(scrapeResponseMeta([secEvent(meta)])).toEqual([meta]);
  });

  it('ignores Custom events with a different tag', () => {
    const meta = {
      url: 'https://x/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    const other = {
      type: EventType.Custom,
      timestamp: 0,
      data: { tag: 'tracelane.nav', payload: meta },
    } as unknown as eventWithTime;
    expect(scrapeResponseMeta([other])).toEqual([]);
  });

  it('ignores non-Custom events', () => {
    const meta = {
      url: 'https://x/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    const notCustom = {
      type: EventType.Meta,
      timestamp: 0,
      data: {},
    } as unknown as eventWithTime;
    expect(scrapeResponseMeta([notCustom, secEvent(meta)])).toEqual([meta]);
  });

  it('skips a payload missing required fields', () => {
    expect(scrapeResponseMeta([secEvent({ url: 'https://x/' })])).toEqual([]);
  });

  it('rejects shape-malformed array element types', () => {
    const badHeaders = {
      url: 'https://x/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [123],
      setCookies: [],
    };
    const badCookies = {
      url: 'https://x/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [{ name: 'sid' }],
    };
    expect(scrapeResponseMeta([secEvent(badHeaders)])).toEqual([]);
    expect(scrapeResponseMeta([secEvent(badCookies)])).toEqual([]);
  });
});
