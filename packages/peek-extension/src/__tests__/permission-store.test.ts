import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_LEVEL } from '../permissions/levels';
import {
  PERMISSION_LEVELS_KEY,
  type StorageAreaLike,
  clearPermissionLevel,
  getPermissionLevel,
  getPermissionLevels,
  setPermissionLevel,
} from '../permissions/store';

const area = fakeBrowser.storage.sync as unknown as StorageAreaLike;

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  fakeBrowser.reset();
});

describe('getPermissionLevels', () => {
  it('returns {} when nothing is stored', async () => {
    expect(await getPermissionLevels(area)).toEqual({});
  });

  it('drops entries with non-http(s) keys or out-of-range values', async () => {
    await area.set({
      [PERMISSION_LEVELS_KEY]: {
        'https://good.com': 3,
        'chrome://bad': 2, // not http(s) → dropped
        'https://oob.com': 9, // OOB → dropped
        'https://neg.com': -1, // OOB → dropped
        'https://nonint.com': 1.5, // not integer → dropped
        'https://nan.com': 'two', // not number → dropped
      },
    });
    expect(await getPermissionLevels(area)).toEqual({ 'https://good.com': 3 });
  });

  it('returns {} when the stored value is not an object', async () => {
    await area.set({ [PERMISSION_LEVELS_KEY]: 'oops' });
    expect(await getPermissionLevels(area)).toEqual({});
  });

  it('normalises the key to the origin component if a URL was stored', async () => {
    // sanitize uses originFromUrl on the KEY too, so a stored full URL maps to
    // its origin on read.
    await area.set({
      [PERMISSION_LEVELS_KEY]: { 'https://example.com/path?q=1': 4 },
    });
    expect(await getPermissionLevels(area)).toEqual({ 'https://example.com': 4 });
  });
});

describe('getPermissionLevel', () => {
  it('defaults to Level 1 (Read-only) when nothing is stored', async () => {
    expect(await getPermissionLevel('https://fresh.com', area)).toBe(DEFAULT_PERMISSION_LEVEL);
  });

  it('returns the stored level for the origin', async () => {
    await setPermissionLevel('https://example.com', 3, area);
    expect(await getPermissionLevel('https://example.com', area)).toBe(3);
  });

  it('accepts a full URL and resolves to its origin', async () => {
    await setPermissionLevel('https://example.com', 2, area);
    expect(await getPermissionLevel('https://example.com/deep/page', area)).toBe(2);
  });

  it('defaults to L1 for an invalid origin (no throw)', async () => {
    expect(await getPermissionLevel('not a url', area)).toBe(DEFAULT_PERMISSION_LEVEL);
  });

  it('does not leak between origins', async () => {
    await setPermissionLevel('https://a.com', 4, area);
    expect(await getPermissionLevel('https://b.com', area)).toBe(DEFAULT_PERMISSION_LEVEL);
  });
});

describe('setPermissionLevel', () => {
  it('persists each of the five levels', async () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      await setPermissionLevel('https://example.com', level, area);
      expect(await getPermissionLevel('https://example.com', area)).toBe(level);
    }
  });

  it('is idempotent — writing the same level twice is a no-op', async () => {
    const first = await setPermissionLevel('https://example.com', 3, area);
    const second = await setPermissionLevel('https://example.com', 3, area);
    expect(second).toEqual(first);
  });

  it('keeps other origins intact when one origin changes', async () => {
    await setPermissionLevel('https://a.com', 0, area);
    await setPermissionLevel('https://b.com', 4, area);
    await setPermissionLevel('https://a.com', 2, area);
    expect(await getPermissionLevels(area)).toEqual({
      'https://a.com': 2,
      'https://b.com': 4,
    });
  });

  it('throws for non-http(s) origins (defense in depth)', async () => {
    await expect(setPermissionLevel('chrome://extensions', 3, area)).rejects.toThrow();
  });

  it('throws for out-of-range levels', async () => {
    await expect(
      setPermissionLevel('https://example.com', 5 as unknown as 4, area),
    ).rejects.toThrow();
    await expect(
      setPermissionLevel('https://example.com', -1 as unknown as 0, area),
    ).rejects.toThrow();
  });

  it('normalises a full URL to its origin before persisting', async () => {
    await setPermissionLevel('https://example.com/deep/path?q=1', 3, area);
    expect(await getPermissionLevels(area)).toEqual({ 'https://example.com': 3 });
  });
});

describe('clearPermissionLevel', () => {
  it('removes a stored level so reads fall back to the default', async () => {
    await setPermissionLevel('https://example.com', 4, area);
    await clearPermissionLevel('https://example.com', area);
    expect(await getPermissionLevel('https://example.com', area)).toBe(DEFAULT_PERMISSION_LEVEL);
  });

  it('is a no-op for an origin that was never stored', async () => {
    await setPermissionLevel('https://kept.com', 2, area);
    await clearPermissionLevel('https://nope.com', area);
    expect(await getPermissionLevels(area)).toEqual({ 'https://kept.com': 2 });
  });
});

describe('concurrent writers (carry-in [4] — multi-writer safety)', () => {
  // Same slow-area pattern as activation/storage's tests — interleaved
  // read-modify-write would lose updates without the write-chain mutex.
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

  it('does not lose updates when two sets race on different origins', async () => {
    const slow = slowArea();
    await Promise.all([
      setPermissionLevel('https://a.com', 3, slow),
      setPermissionLevel('https://b.com', 4, slow),
    ]);
    expect(await getPermissionLevels(slow)).toEqual({
      'https://a.com': 3,
      'https://b.com': 4,
    });
  });

  it('serializes a set + a clear on the same origin deterministically', async () => {
    const slow = slowArea();
    await setPermissionLevel('https://a.com', 3, slow);
    // A racing set + clear: whichever is submitted later wins (FIFO chain).
    await Promise.all([
      setPermissionLevel('https://a.com', 4, slow),
      clearPermissionLevel('https://a.com', slow),
    ]);
    // The clear was scheduled SECOND, so it runs last under FIFO → cleared.
    expect(await getPermissionLevel('https://a.com', slow)).toBe(DEFAULT_PERMISSION_LEVEL);
  });
});
