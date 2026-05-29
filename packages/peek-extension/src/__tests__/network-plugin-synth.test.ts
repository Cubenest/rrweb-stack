/**
 * Unit tests for the SW network-plugin synthesizer (alpha.6, Phase 5 task #72).
 *
 * The synthesizer is the load-bearing back-compat shim: it converts the new
 * `getRecordNetworkPlugin` plugin events (`EventType.Plugin` /
 * `rrweb/network@1`) into the legacy `NetMessage` wire shape so peek-mcp's
 * `network_events` SQLite table + the `get_session_network_errors` MCP tool
 * keep returning rows after the recorder migration. The function is pure, so
 * we cover it without a SW / Chrome.
 *
 * Spec the tests pin:
 *   - Plugin events are detected by shape (type === 6 + data.plugin === 'rrweb/network@1')
 *   - Each captured request → ALWAYS a `request` envelope + ONE of
 *     `response` (status > 0) / `error` (status === 0)
 *   - Non-plugin events in the batch are ignored
 *   - Malformed plugin payloads do NOT throw — they yield zero envelopes
 *   - Field mapping matches what peek-mcp's `ingestNetworkAppend` reads
 *     (method/url/status/transport/headers/bodies/error)
 */

import { describe, expect, it } from 'vitest';
import {
  isNetworkPluginEvent,
  synthesizeNetMessagesFromEvents,
} from '../background/network-plugin-synth';

/** Build a well-formed network-plugin event (the happy-path shape). */
const pluginEvent = (
  requests: Array<Record<string, unknown>>,
  timestamp = 1_700_000_000_000,
): unknown => ({
  type: 6, // EventType.Plugin
  timestamp,
  data: {
    plugin: 'rrweb/network@1',
    payload: { requests },
  },
});

describe('isNetworkPluginEvent', () => {
  it('accepts a well-formed network plugin event', () => {
    expect(isNetworkPluginEvent(pluginEvent([{ name: 'https://x.test' }]))).toBe(true);
  });

  it('rejects other event types (FullSnapshot, IncrementalSnapshot, …)', () => {
    expect(isNetworkPluginEvent({ type: 2, data: {} })).toBe(false); // FullSnapshot
    expect(isNetworkPluginEvent({ type: 3, data: {} })).toBe(false); // Incremental
  });

  it('rejects the console plugin event (same EventType.Plugin, different plugin)', () => {
    expect(
      isNetworkPluginEvent({
        type: 6,
        data: { plugin: 'rrweb/console@1', payload: { level: 'log', payload: [] } },
      }),
    ).toBe(false);
  });

  it('rejects null/undefined/non-objects without throwing', () => {
    expect(isNetworkPluginEvent(null)).toBe(false);
    expect(isNetworkPluginEvent(undefined)).toBe(false);
    expect(isNetworkPluginEvent('hello')).toBe(false);
    expect(isNetworkPluginEvent(42)).toBe(false);
  });

  it('rejects a plugin event missing requests[]', () => {
    expect(isNetworkPluginEvent({ type: 6, data: { plugin: 'rrweb/network@1' } })).toBe(false);
    expect(
      isNetworkPluginEvent({
        type: 6,
        data: { plugin: 'rrweb/network@1', payload: { requests: 'not-an-array' } },
      }),
    ).toBe(false);
  });
});

describe('synthesizeNetMessagesFromEvents', () => {
  it('returns [] for an empty batch', () => {
    expect(synthesizeNetMessagesFromEvents([])).toEqual([]);
  });

  it('ignores non-plugin events in the stream', () => {
    expect(
      synthesizeNetMessagesFromEvents([
        { type: 2, data: {} },
        { type: 3, data: { source: 0 } },
      ]),
    ).toEqual([]);
  });

  it('emits a request + response pair for a successful fetch', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        {
          name: 'https://api.test/v1/items',
          method: 'POST',
          status: 201,
          initiatorType: 'fetch',
          timeOrigin: 1_700_000_000_000,
          requestMadeAt: 100,
          responseEnd: 200,
          timestamp: 1_700_000_000_100,
        },
      ]),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      kind: 'request',
      method: 'POST',
      url: 'https://api.test/v1/items',
      transport: 'fetch',
      ts: 1_700_000_000_100,
    });
    expect(out[1]).toMatchObject({
      kind: 'response',
      status: 201,
      ts: 1_700_000_000_200,
    });
    // The two share the same correlation id (so peek-mcp's lifecycle joins).
    const [req, resp] = out as [(typeof out)[0], (typeof out)[0]];
    expect(req.id).toBe(resp.id);
    expect(req.id).toMatch(/^plugin-/);
  });

  it('maps XHR initiatorType to transport=xhr', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        {
          name: 'https://x.test/q',
          method: 'GET',
          status: 200,
          initiatorType: 'xmlhttprequest',
        },
      ]),
    ]);
    const [req] = out as [(typeof out)[0]];
    expect(req.transport).toBe('xhr');
  });

  it('omits transport for non-fetch/non-XHR initiators (PerformanceObserver entries)', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        // a stylesheet load picked up by PerformanceObserver — no method, no
        // status, just timing. The synth still emits request + response so
        // the lifecycle row exists; transport stays undefined so peek-mcp's
        // `resource_type` column lands as SQL NULL.
        {
          name: 'https://cdn.test/site.css',
          initiatorType: 'css',
          isInitial: true,
        },
      ]),
    ]);
    expect(out).toHaveLength(2);
    const [req, resp] = out as [(typeof out)[0], (typeof out)[0]];
    expect(req).not.toHaveProperty('transport');
    expect(req.method).toBe('GET'); // default
    expect(resp.status).toBe(0); // PerformanceObserver-only ⇒ 0
  });

  it('emits an error envelope when status === 0 (network failure)', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        {
          name: 'https://offline.test/api',
          method: 'GET',
          status: 0,
          initiatorType: 'fetch',
        },
      ]),
    ]);
    expect(out).toHaveLength(2);
    const [req, errEnv] = out as [(typeof out)[0], (typeof out)[0]];
    expect(req.kind).toBe('request');
    expect(errEnv).toMatchObject({
      kind: 'error',
      error: expect.stringContaining('network error'),
    });
    expect(errEnv).not.toHaveProperty('status');
  });

  it('emits a response envelope for 4xx/5xx (status >= 400) — these are the rows get_session_network_errors returns', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        {
          name: 'https://api.test/auth',
          method: 'POST',
          status: 401,
          initiatorType: 'fetch',
        },
        {
          name: 'https://api.test/crash',
          method: 'GET',
          status: 500,
          initiatorType: 'fetch',
        },
      ]),
    ]);
    expect(out).toHaveLength(4); // 2 requests × (request + response)
    expect(out.filter((r) => r.kind === 'response').map((r) => r.status)).toEqual([401, 500]);
  });

  it('forwards captured headers + bodies when the plugin recorded them', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        {
          name: 'https://api.test/v1/users',
          method: 'POST',
          status: 200,
          initiatorType: 'fetch',
          requestHeaders: { 'content-type': 'application/json' },
          responseHeaders: { 'x-trace-id': 'abc-123' },
          requestBody: '{"name":"alice"}',
          responseBody: '{"id":42}',
        },
      ]),
    ]);
    const [req, resp] = out as [(typeof out)[0], (typeof out)[0]];
    expect(req.headers).toEqual({ 'content-type': 'application/json' });
    expect(req.requestBody).toBe('{"name":"alice"}');
    expect(resp.headers).toEqual({ 'x-trace-id': 'abc-123' });
    expect(resp.responseBody).toBe('{"id":42}');
  });

  it('omits header/body fields when the plugin did NOT capture them (alpha.6 defaults)', () => {
    // recordHeaders: false + recordBody: false ⇒ the plugin emits requests
    // with all those fields undefined. The synthesizer must omit them so the
    // wire shape is minimal + peek-mcp's ingest stores NULL (P-18 fix).
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        {
          name: 'https://api.test/v1/ping',
          method: 'GET',
          status: 200,
          initiatorType: 'fetch',
        },
      ]),
    ]);
    const [req, resp] = out as [(typeof out)[0], (typeof out)[0]];
    expect('headers' in req).toBe(false);
    expect('requestBody' in req).toBe(false);
    expect('headers' in resp).toBe(false);
    expect('responseBody' in resp).toBe(false);
  });

  it('walks multiple requests in one plugin payload (a PerformanceObserver flush)', () => {
    const out = synthesizeNetMessagesFromEvents([
      pluginEvent([
        { name: 'https://a.test/1', initiatorType: 'css', isInitial: true },
        { name: 'https://a.test/2', initiatorType: 'img', isInitial: true },
        { name: 'https://a.test/3', initiatorType: 'script', isInitial: true },
      ]),
    ]);
    expect(out).toHaveLength(6); // 3 × (request + response)
  });

  it('does not throw on a malformed payload (defensive — page-realm input)', () => {
    expect(() =>
      synthesizeNetMessagesFromEvents([
        { type: 6, data: { plugin: 'rrweb/network@1', payload: null } },
        { type: 6, data: { plugin: 'rrweb/network@1' } },
        null,
        undefined,
        'hello',
      ]),
    ).not.toThrow();
  });

  it('produces stable ids — same request synthesized twice yields the same id', () => {
    const req = {
      name: 'https://api.test/v1/items',
      method: 'POST',
      status: 201,
      initiatorType: 'fetch',
      timeOrigin: 1_700_000_000_000,
      requestMadeAt: 100,
      responseEnd: 200,
    };
    const a = synthesizeNetMessagesFromEvents([pluginEvent([{ ...req }])]);
    const b = synthesizeNetMessagesFromEvents([pluginEvent([{ ...req }])]);
    const [a0] = a as [(typeof a)[0]];
    const [b0] = b as [(typeof b)[0]];
    expect(a0.id).toBe(b0.id);
  });
});
