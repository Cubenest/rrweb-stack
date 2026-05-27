import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_CHARS,
  bodyToString,
  buildFetchRequest,
  buildFetchResponse,
  buildNetError,
  capBody,
  headersToObject,
  methodFromFetch,
  urlFromFetchInput,
} from '../recorder/net-capture';

describe('headersToObject', () => {
  it('returns {} for nullish input', () => {
    expect(headersToObject(undefined)).toEqual({});
    expect(headersToObject(null)).toEqual({});
  });

  it('reads a Headers instance', () => {
    const h = new Headers({ 'Content-Type': 'application/json', 'X-Foo': 'bar' });
    const out = headersToObject(h);
    // Headers lower-cases names.
    expect(out['content-type']).toBe('application/json');
    expect(out['x-foo']).toBe('bar');
  });

  it('reads an array of tuples', () => {
    expect(
      headersToObject([
        ['A', '1'],
        ['B', '2'],
      ]),
    ).toEqual({ A: '1', B: '2' });
  });

  it('reads a plain object and stringifies non-string values', () => {
    expect(headersToObject({ A: '1', B: 2 as unknown as string })).toEqual({ A: '1', B: '2' });
  });
});

describe('capBody', () => {
  it('passes through short bodies unchanged', () => {
    expect(capBody('hello')).toBe('hello');
  });

  it('truncates and annotates overlong bodies', () => {
    const long = 'x'.repeat(MAX_BODY_CHARS + 100);
    const out = capBody(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain('[+100 chars]');
    expect(out.startsWith('x'.repeat(MAX_BODY_CHARS))).toBe(true);
  });

  it('honors a custom cap', () => {
    expect(capBody('abcdef', 3)).toBe('abc… [+3 chars]');
  });
});

describe('bodyToString', () => {
  it('returns undefined for null/undefined', () => {
    expect(bodyToString(null)).toBeUndefined();
    expect(bodyToString(undefined)).toBeUndefined();
  });

  it('passes strings through (capped)', () => {
    expect(bodyToString('a=1&b=2')).toBe('a=1&b=2');
  });

  it('serializes URLSearchParams', () => {
    expect(bodyToString(new URLSearchParams({ a: '1', b: '2' }))).toBe('a=1&b=2');
  });

  it('reports FormData / Blob / ArrayBuffer by type, never consumes them', () => {
    expect(bodyToString(new FormData())).toBe('[FormData]');
    expect(bodyToString(new Blob(['abc']))).toBe('[Blob 3B]');
    expect(bodyToString(new ArrayBuffer(8))).toBe('[ArrayBuffer 8B]');
  });
});

describe('urlFromFetchInput / methodFromFetch', () => {
  it('resolves a string URL', () => {
    expect(urlFromFetchInput('https://x.test/a')).toBe('https://x.test/a');
  });

  it('resolves a URL instance', () => {
    expect(urlFromFetchInput(new URL('https://x.test/a'))).toBe('https://x.test/a');
  });

  it('resolves a Request-like object', () => {
    expect(urlFromFetchInput({ url: 'https://x.test/b' })).toBe('https://x.test/b');
  });

  it('defaults method to GET and upper-cases', () => {
    expect(methodFromFetch('https://x', undefined)).toBe('GET');
    expect(methodFromFetch('https://x', { method: 'post' })).toBe('POST');
    expect(methodFromFetch({ url: 'https://x', method: 'delete' }, undefined)).toBe('DELETE');
  });
});

describe('buildFetchRequest', () => {
  it('shapes a request record with raw headers + body', () => {
    const rec = buildFetchRequest(
      'id-1',
      'https://x.test/a',
      { method: 'POST', headers: { Authorization: 'Bearer s3cret' }, body: 'q=1' },
      1234,
    );
    expect(rec).toMatchObject({
      kind: 'request',
      id: 'id-1',
      ts: 1234,
      transport: 'fetch',
      url: 'https://x.test/a',
      method: 'POST',
      // RAW here — redaction is the ISOLATED relay's job, not MAIN world's.
      headers: { Authorization: 'Bearer s3cret' },
      requestBody: 'q=1',
    });
  });

  it('omits requestBody when there is no body', () => {
    const rec = buildFetchRequest('id-2', 'https://x.test', { method: 'GET' }, 1);
    expect('requestBody' in rec).toBe(false);
  });
});

describe('buildFetchResponse / buildNetError', () => {
  it('shapes a response record with capped body', () => {
    const rec = buildFetchResponse('id-1', 200, { 'content-type': 'text/plain' }, 'body', 9);
    expect(rec).toMatchObject({
      kind: 'response',
      id: 'id-1',
      ts: 9,
      status: 200,
      headers: { 'content-type': 'text/plain' },
      responseBody: 'body',
    });
  });

  it('shapes an error record from an Error or a string', () => {
    expect(buildNetError('id', new Error('boom'), 3)).toMatchObject({
      kind: 'error',
      id: 'id',
      ts: 3,
      error: 'boom',
    });
    expect(buildNetError('id', 'nope', 3).error).toBe('nope');
  });
});
