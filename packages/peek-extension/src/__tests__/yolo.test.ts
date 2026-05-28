import { describe, expect, it, vi } from 'vitest';
import { YOLO_MAX_LIFETIME_MS, YoloSessionStore, type YoloStoreDeps } from '../permissions/yolo';

/** Test deps that let us advance fake time + collect scheduled callbacks. */
function fakeDeps(): YoloStoreDeps & {
  /** Manually drain timers whose deadlines have been reached. */
  tick(ms: number): void;
  /** ms-since-epoch fakes start at 0 and accumulate via `tick`. */
  readonly nowMs: { value: number };
} {
  const nowMs = { value: 0 };
  const scheduled: Array<{ cb: () => void; fireAt: number; cleared: boolean }> = [];

  const deps: YoloStoreDeps = {
    now: () => nowMs.value,
    setTimeout(cb, ms) {
      const entry = { cb, fireAt: nowMs.value + ms, cleared: false };
      scheduled.push(entry);
      return entry;
    },
    clearTimeout(handle) {
      const entry = handle as { cleared: boolean };
      entry.cleared = true;
    },
  };

  return Object.assign(deps, {
    nowMs,
    tick(ms: number) {
      nowMs.value += ms;
      for (const entry of scheduled) {
        if (entry.cleared) continue;
        if (entry.fireAt <= nowMs.value) {
          entry.cleared = true;
          entry.cb();
        }
      }
    },
  });
}

describe('YoloSessionStore.activate', () => {
  it('marks the origin active and records the floor', () => {
    const deps = fakeDeps();
    const store = new YoloSessionStore(deps);
    store.activate('https://example.com', 42, 3);
    expect(store.isActive('https://example.com')).toBe(true);
    expect(store.get('https://example.com')).toMatchObject({
      origin: 'https://example.com',
      tabId: 42,
      floor: 3,
    });
  });

  it('replacing an active grant clears the previous timer (no stale expiry)', () => {
    const deps = fakeDeps();
    const expiries: string[] = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry((origin) => expiries.push(origin));

    store.activate('https://example.com', 1, 3);
    // Advance halfway, then re-activate — the original timer should NOT fire
    // after we cross its original deadline.
    deps.tick(YOLO_MAX_LIFETIME_MS / 2);
    store.activate('https://example.com', 1, 3);
    deps.tick(YOLO_MAX_LIFETIME_MS / 2 + 1); // would have crossed the old deadline
    expect(expiries).toEqual([]);
    // Crossing the NEW deadline fires exactly once.
    deps.tick(YOLO_MAX_LIFETIME_MS / 2);
    expect(expiries).toEqual(['https://example.com']);
  });
});

describe('YoloSessionStore.isActive', () => {
  it('is false for an origin with no grant', () => {
    const store = new YoloSessionStore(fakeDeps());
    expect(store.isActive('https://nope.com')).toBe(false);
  });

  it('returns to false after 60 min', () => {
    const deps = fakeDeps();
    const store = new YoloSessionStore(deps);
    store.activate('https://example.com', 1, 2);
    deps.tick(YOLO_MAX_LIFETIME_MS - 1);
    expect(store.isActive('https://example.com')).toBe(true);
    deps.tick(1);
    expect(store.isActive('https://example.com')).toBe(false);
  });
});

describe('YoloSessionStore.onTabClosed', () => {
  it('expires the grant immediately when the anchoring tab closes', () => {
    const deps = fakeDeps();
    const expiries: Array<[string, number]> = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry((origin, floor) => expiries.push([origin, floor]));

    store.activate('https://example.com', 7, 3);
    store.onTabClosed(7);
    expect(store.isActive('https://example.com')).toBe(false);
    expect(expiries).toEqual([['https://example.com', 3]]);
  });

  it('does NOT expire a grant on an unrelated tab close', () => {
    const deps = fakeDeps();
    const store = new YoloSessionStore(deps);
    store.activate('https://example.com', 7, 1);
    store.onTabClosed(99);
    expect(store.isActive('https://example.com')).toBe(true);
  });

  it('expires every origin anchored to the closed tab', () => {
    const deps = fakeDeps();
    const expiries: string[] = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry((origin) => expiries.push(origin));

    store.activate('https://a.com', 3, 1);
    store.activate('https://b.com', 3, 2);
    store.activate('https://c.com', 5, 0); // different tab — stays active
    store.onTabClosed(3);
    expect(expiries.sort()).toEqual(['https://a.com', 'https://b.com']);
    expect(store.isActive('https://c.com')).toBe(true);
  });

  it('cancels the 60-min timer when the tab closes early (no double expiry)', () => {
    const deps = fakeDeps();
    const expiries: string[] = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry((origin) => expiries.push(origin));

    store.activate('https://example.com', 1, 1);
    store.onTabClosed(1);
    deps.tick(YOLO_MAX_LIFETIME_MS + 1); // would-be timer firing time
    expect(expiries).toEqual(['https://example.com']); // exactly once
  });
});

describe('YoloSessionStore.revoke', () => {
  it('expires immediately and notifies listeners', () => {
    const deps = fakeDeps();
    const expiries: Array<[string, number]> = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry((origin, floor) => expiries.push([origin, floor]));

    store.activate('https://example.com', 1, 4);
    store.revoke('https://example.com');
    expect(store.isActive('https://example.com')).toBe(false);
    expect(expiries).toEqual([['https://example.com', 4]]);
  });

  it('is a no-op for an origin that isn’t active', () => {
    const deps = fakeDeps();
    const expiries: string[] = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry((origin) => expiries.push(origin));
    store.revoke('https://nope.com');
    expect(expiries).toEqual([]);
  });
});

describe('YoloSessionStore.onExpiry', () => {
  it('a throwing listener does not prevent other listeners from firing', () => {
    const deps = fakeDeps();
    const calls: string[] = [];
    const store = new YoloSessionStore(deps);
    store.onExpiry(() => {
      throw new Error('boom');
    });
    store.onExpiry((origin) => calls.push(origin));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    store.activate('https://example.com', 1, 1);
    store.revoke('https://example.com');
    expect(calls).toEqual(['https://example.com']);
    warn.mockRestore();
  });

  it('unsubscribe stops further notifications', () => {
    const deps = fakeDeps();
    const calls: string[] = [];
    const store = new YoloSessionStore(deps);
    const off = store.onExpiry((origin) => calls.push(origin));

    store.activate('https://example.com', 1, 1);
    off();
    store.revoke('https://example.com');
    expect(calls).toEqual([]);
  });
});

describe('activeCount', () => {
  it('reflects the live count of YOLO grants', () => {
    const deps = fakeDeps();
    const store = new YoloSessionStore(deps);
    expect(store.activeCount).toBe(0);
    store.activate('https://a.com', 1, 1);
    store.activate('https://b.com', 2, 1);
    expect(store.activeCount).toBe(2);
    store.revoke('https://a.com');
    expect(store.activeCount).toBe(1);
  });
});
