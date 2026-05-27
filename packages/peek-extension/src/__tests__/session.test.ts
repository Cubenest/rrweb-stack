import { describe, expect, it } from 'vitest';
import { SessionRegistry, newSessionId } from '../background/session';

describe('newSessionId', () => {
  it('produces a unique s_-prefixed id', () => {
    const a = newSessionId();
    const b = newSessionId();
    expect(a.startsWith('s_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('SessionRegistry', () => {
  it('creates one session per tab and reuses it', () => {
    const r = new SessionRegistry();
    const first = r.ensure(1, { url: 'https://x.test/a' });
    const second = r.ensure(1, { url: 'https://x.test/b' }); // same origin
    expect(second.sessionId).toBe(first.sessionId);
    expect(r.trackedTabs).toBe(1);
  });

  it('rotates the session on a cross-origin navigation', () => {
    const r = new SessionRegistry();
    const first = r.ensure(1, { url: 'https://a.test/' });
    const afterNav = r.ensure(1, { url: 'https://b.test/' });
    expect(afterNav.sessionId).not.toBe(first.sessionId);
  });

  it('carries url + title into the SessionRef', () => {
    const r = new SessionRegistry();
    const ref = r.ensure(1, { url: 'https://x.test/p', title: 'Hello' });
    expect(ref).toMatchObject({ url: 'https://x.test/p', title: 'Hello' });
  });

  it('keeps tabs independent', () => {
    const r = new SessionRegistry();
    const a = r.ensure(1, { url: 'https://x.test/' });
    const b = r.ensure(2, { url: 'https://x.test/' });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('clear() forgets a tab so a later ensure starts fresh', () => {
    const r = new SessionRegistry();
    const first = r.ensure(1, { url: 'https://x.test/' });
    r.clear(1);
    expect(r.trackedTabs).toBe(0);
    const again = r.ensure(1, { url: 'https://x.test/' });
    expect(again.sessionId).not.toBe(first.sessionId);
  });

  it('tolerates an unparseable URL without rotating spuriously', () => {
    const r = new SessionRegistry();
    const first = r.ensure(1, { url: 'https://x.test/' });
    const again = r.ensure(1, { url: 'not a url' });
    // No valid origin → no rotation.
    expect(again.sessionId).toBe(first.sessionId);
  });
});
