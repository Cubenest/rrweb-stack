import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type StorageAreaLike,
  addEnabledOrigin,
  getEnabledOrigins,
  isOriginEnabled,
  removeEnabledOrigin,
} from '../activation/storage';
import { ENABLED_ORIGINS_KEY } from '../constants';

// The helpers accept a StorageAreaLike; pass WXT's bundled fake `storage.sync`
// so we exercise the real read/write path without a browser. `fakeBrowser`
// implements the same async Promise-based API as `chrome.storage`.
const area = fakeBrowser.storage.sync as unknown as StorageAreaLike;

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('getEnabledOrigins', () => {
  it('returns [] when nothing is stored', async () => {
    expect(await getEnabledOrigins(area)).toEqual([]);
  });

  it('sanitizes, de-dupes, and sorts stored values', async () => {
    await area.set({
      [ENABLED_ORIGINS_KEY]: [
        'https://b.com',
        'https://a.com',
        'https://b.com', // dup
        'https://a.com/path', // same origin as a.com → dedup to origin
        'chrome://x', // not http(s) → dropped
        42, // non-string → dropped
      ],
    });
    expect(await getEnabledOrigins(area)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('returns [] when the stored value is not an array', async () => {
    await area.set({ [ENABLED_ORIGINS_KEY]: 'oops' });
    expect(await getEnabledOrigins(area)).toEqual([]);
  });
});

describe('addEnabledOrigin', () => {
  it('persists a new origin and returns the updated list', async () => {
    const list = await addEnabledOrigin('https://example.com', area);
    expect(list).toEqual(['https://example.com']);
    expect(await getEnabledOrigins(area)).toEqual(['https://example.com']);
  });

  it('stores only the origin component of a full URL', async () => {
    await addEnabledOrigin('https://example.com/deep/path?q=1', area);
    expect(await getEnabledOrigins(area)).toEqual(['https://example.com']);
  });

  it('is idempotent — re-adding does not duplicate', async () => {
    await addEnabledOrigin('https://example.com', area);
    const list = await addEnabledOrigin('https://example.com', area);
    expect(list).toEqual(['https://example.com']);
  });

  it('keeps the list sorted', async () => {
    await addEnabledOrigin('https://zeta.com', area);
    await addEnabledOrigin('https://alpha.com', area);
    expect(await getEnabledOrigins(area)).toEqual(['https://alpha.com', 'https://zeta.com']);
  });

  it('throws for non-http(s) origins', async () => {
    await expect(addEnabledOrigin('chrome://extensions', area)).rejects.toThrow();
  });
});

describe('removeEnabledOrigin', () => {
  it('removes a persisted origin', async () => {
    await addEnabledOrigin('https://a.com', area);
    await addEnabledOrigin('https://b.com', area);
    const list = await removeEnabledOrigin('https://a.com', area);
    expect(list).toEqual(['https://b.com']);
    expect(await getEnabledOrigins(area)).toEqual(['https://b.com']);
  });

  it('is a no-op for an origin that was never enabled', async () => {
    await addEnabledOrigin('https://a.com', area);
    const list = await removeEnabledOrigin('https://nope.com', area);
    expect(list).toEqual(['https://a.com']);
  });

  it('normalizes a full URL down to its origin before removing', async () => {
    await addEnabledOrigin('https://a.com', area);
    const list = await removeEnabledOrigin('https://a.com/some/path', area);
    expect(list).toEqual([]);
  });
});

describe('isOriginEnabled', () => {
  it('is true only for enabled origins', async () => {
    await addEnabledOrigin('https://a.com', area);
    expect(await isOriginEnabled('https://a.com/page', area)).toBe(true);
    expect(await isOriginEnabled('https://b.com/page', area)).toBe(false);
  });

  it('is false for a subdomain of an enabled origin (distinct origin)', async () => {
    await addEnabledOrigin('https://example.com', area);
    expect(await isOriginEnabled('https://app.example.com', area)).toBe(false);
  });

  it('is false for non-activatable URLs', async () => {
    await addEnabledOrigin('https://a.com', area);
    expect(await isOriginEnabled('chrome://x', area)).toBe(false);
  });
});

describe('concurrent writers (carry-in [4] — multi-writer safety)', () => {
  // A storage area whose get/set resolve on a microtask delay, so concurrent
  // read-modify-write calls would interleave (read→read→write→write) WITHOUT
  // the serialization lock — the classic lost-update race. The lock must make
  // them apply sequentially so every addition survives.
  function slowArea(): StorageAreaLike {
    let store: Record<string, unknown> = {};
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));
    return {
      async get(keys) {
        await tick();
        if (typeof keys === 'string') return { [keys]: store[keys] };
        return { ...store };
      },
      async set(items) {
        await tick();
        store = { ...store, ...items };
      },
    };
  }

  it('does not lose updates when two adds race on the same area', async () => {
    const slow = slowArea();
    // Fire two adds without awaiting between them — they race.
    await Promise.all([
      addEnabledOrigin('https://a.com', slow),
      addEnabledOrigin('https://b.com', slow),
    ]);
    // Without the lock, one write clobbers the other and only one origin lands.
    expect(await getEnabledOrigins(slow)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('serializes a burst of adds + a remove deterministically', async () => {
    const slow = slowArea();
    await Promise.all([
      addEnabledOrigin('https://a.com', slow),
      addEnabledOrigin('https://b.com', slow),
      addEnabledOrigin('https://c.com', slow),
    ]);
    await removeEnabledOrigin('https://b.com', slow);
    expect(await getEnabledOrigins(slow)).toEqual(['https://a.com', 'https://c.com']);
  });
});
