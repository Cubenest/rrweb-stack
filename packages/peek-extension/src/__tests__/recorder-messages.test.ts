import { describe, expect, it } from 'vitest';
import { PEEK_RRWEB_SOURCE, isPeekMessage, isRrwebMessage } from '../recorder/messages';

describe('isPeekMessage', () => {
  it('accepts the peek source tag', () => {
    expect(isPeekMessage({ source: PEEK_RRWEB_SOURCE, payload: {} })).toBe(true);
  });

  it('rejects non-peek sources (the privacy boundary first gate)', () => {
    expect(isPeekMessage({ source: 'evil', payload: {} })).toBe(false);
    expect(isPeekMessage({ source: 'p2', payload: {} })).toBe(false); // old codename, not accepted
    // The pre-alpha.6 'peek-net' source is no longer accepted (Phase 5 / Task #72
    // deleted the MAIN-world fetch/XHR monkey-patch — only the rrweb event
    // stream rides this channel now).
    expect(isPeekMessage({ source: 'peek-net', payload: { kind: 'request', id: 'x' } })).toBe(
      false,
    );
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

  it('is false when payload is null', () => {
    const msg = { source: PEEK_RRWEB_SOURCE, payload: null } as const;
    expect(isRrwebMessage(msg)).toBe(false);
  });
});
