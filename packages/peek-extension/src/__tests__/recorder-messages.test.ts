import { describe, expect, it } from 'vitest';
import {
  PEEK_NET_SOURCE,
  PEEK_RRWEB_SOURCE,
  isNetMessage,
  isPeekMessage,
  isRrwebMessage,
} from '../recorder/messages';

describe('isPeekMessage', () => {
  it('accepts the two peek source tags', () => {
    expect(isPeekMessage({ source: PEEK_RRWEB_SOURCE, payload: {} })).toBe(true);
    expect(isPeekMessage({ source: PEEK_NET_SOURCE, payload: { kind: 'request', id: 'x' } })).toBe(
      true,
    );
  });

  it('rejects non-peek sources (the privacy boundary first gate)', () => {
    expect(isPeekMessage({ source: 'evil', payload: {} })).toBe(false);
    expect(isPeekMessage({ source: 'p2', payload: {} })).toBe(false); // old codename, not accepted
    expect(isPeekMessage({ type: 'something' })).toBe(false);
  });

  it('rejects non-objects and null without throwing', () => {
    expect(isPeekMessage(null)).toBe(false);
    expect(isPeekMessage(undefined)).toBe(false);
    expect(isPeekMessage('peek')).toBe(false);
    expect(isPeekMessage(42)).toBe(false);
    expect(isPeekMessage([])).toBe(false);
  });
});

describe('isRrwebMessage', () => {
  it('is true for a peek rrweb message with a payload', () => {
    const msg = { source: PEEK_RRWEB_SOURCE, payload: { type: 2 } } as const;
    expect(isPeekMessage(msg) && isRrwebMessage(msg)).toBe(true);
  });

  it('is false for a net message', () => {
    const msg = { source: PEEK_NET_SOURCE, payload: { kind: 'request', id: 'a' } } as const;
    expect(isPeekMessage(msg) && isRrwebMessage(msg)).toBe(false);
  });

  it('is false when payload is null', () => {
    const msg = { source: PEEK_RRWEB_SOURCE, payload: null } as const;
    expect(isRrwebMessage(msg)).toBe(false);
  });
});

describe('isNetMessage', () => {
  // These validators run on untrusted `window.postMessage` data, so the tests
  // deliberately feed malformed shapes. `asPeek` widens those literals to the
  // validator input type (the runtime guard is exactly what's under test).
  const asPeek = (v: unknown): Parameters<typeof isNetMessage>[0] =>
    v as Parameters<typeof isNetMessage>[0];

  it('accepts well-formed request/response/error records', () => {
    for (const kind of ['request', 'response', 'error'] as const) {
      const msg = asPeek({ source: PEEK_NET_SOURCE, payload: { kind, id: 'req-1', ts: 1 } });
      expect(isNetMessage(msg)).toBe(true);
    }
  });

  it('rejects a missing/empty correlation id', () => {
    expect(
      isNetMessage(asPeek({ source: PEEK_NET_SOURCE, payload: { kind: 'request', id: '' } })),
    ).toBe(false);
    expect(isNetMessage(asPeek({ source: PEEK_NET_SOURCE, payload: { kind: 'request' } }))).toBe(
      false,
    );
  });

  it('rejects an unknown kind', () => {
    expect(
      isNetMessage(asPeek({ source: PEEK_NET_SOURCE, payload: { kind: 'frobnicate', id: 'x' } })),
    ).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(isNetMessage(asPeek({ source: PEEK_NET_SOURCE, payload: 'nope' }))).toBe(false);
  });

  it('rejects an rrweb message routed as net', () => {
    expect(isNetMessage(asPeek({ source: PEEK_RRWEB_SOURCE, payload: {} }))).toBe(false);
  });
});
