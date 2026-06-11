import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import { SEC_CONSOLE_PREFIX } from '../src/index.js';
import { scrapeResponseMeta } from '../src/response-meta.js';

// Build a console-plugin event the way the rrweb console plugin records a console.error
// (string args are JSON-encoded → arrive double-quoted in payload.payload).
function secEvent(rawMessage: string, ts = 0): eventWithTime {
  return {
    type: EventType.Plugin,
    timestamp: ts,
    data: {
      plugin: 'rrweb/console@1',
      payload: { level: 'error', payload: [JSON.stringify(rawMessage)] },
    },
  } as unknown as eventWithTime;
}

describe('scrapeResponseMeta', () => {
  it('parses [tracelane.sec] console lines into ResponseMeta', () => {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: ['content-security-policy'],
      setCookies: [],
    };
    const ev = secEvent(`${SEC_CONSOLE_PREFIX} ${JSON.stringify(meta)}`);
    expect(scrapeResponseMeta([ev])).toEqual([meta]);
  });

  it('ignores non-sec console lines', () => {
    expect(scrapeResponseMeta([secEvent('[tracelane.net] GET 500 https://x')])).toEqual([]);
  });

  it('skips malformed JSON after the prefix', () => {
    expect(scrapeResponseMeta([secEvent(`${SEC_CONSOLE_PREFIX} not-json`)])).toEqual([]);
  });

  it('skips a JSON object missing required fields', () => {
    expect(
      scrapeResponseMeta([
        secEvent(`${SEC_CONSOLE_PREFIX} ${JSON.stringify({ url: 'https://x/' })}`),
      ]),
    ).toEqual([]);
  });

  it('skips lines where the prefix is not at the start (false-positive guard)', () => {
    const meta = {
      url: 'https://x/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    expect(
      scrapeResponseMeta([secEvent(`logged: ${SEC_CONSOLE_PREFIX} ${JSON.stringify(meta)}`)]),
    ).toEqual([]);
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
    expect(
      scrapeResponseMeta([secEvent(`${SEC_CONSOLE_PREFIX} ${JSON.stringify(badHeaders)}`)]),
    ).toEqual([]);
    expect(
      scrapeResponseMeta([secEvent(`${SEC_CONSOLE_PREFIX} ${JSON.stringify(badCookies)}`)]),
    ).toEqual([]);
  });

  it('ignores non-plugin events', () => {
    const meta = {
      url: 'https://x/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    const notPlugin = { type: EventType.Meta, timestamp: 0, data: {} } as unknown as eventWithTime;
    expect(
      scrapeResponseMeta([notPlugin, secEvent(`${SEC_CONSOLE_PREFIX} ${JSON.stringify(meta)}`)]),
    ).toEqual([meta]);
  });
});
