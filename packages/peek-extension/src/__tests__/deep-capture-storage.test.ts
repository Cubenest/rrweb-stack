// Deep-capture per-origin opt-in storage (Task 3.26).

import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEEP_CAPTURE_ORIGINS_KEY,
  type StorageAreaLike,
  diffRemovedOrigins,
  disableDeepCapture,
  enableDeepCapture,
  getDeepCaptureOrigins,
  isDeepCaptureEnabled,
} from '../deep-capture/storage';

const area = fakeBrowser.storage.sync as unknown as StorageAreaLike;

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(() => {
  fakeBrowser.reset();
});

describe('Deep capture origin store', () => {
  it('defaults to [] when nothing has been stored', async () => {
    expect(await getDeepCaptureOrigins(area)).toEqual([]);
  });

  it('persists an origin and reads it back', async () => {
    await enableDeepCapture('https://example.com', area);
    expect(await getDeepCaptureOrigins(area)).toEqual(['https://example.com']);
    expect(await isDeepCaptureEnabled('https://example.com/page', area)).toBe(true);
  });

  it('is idempotent — re-enabling the same origin is a no-op', async () => {
    const first = await enableDeepCapture('https://a.com', area);
    const second = await enableDeepCapture('https://a.com', area);
    expect(second).toEqual(first);
  });

  it('sorts + de-dupes across multiple enables', async () => {
    await enableDeepCapture('https://b.com', area);
    await enableDeepCapture('https://a.com', area);
    expect(await getDeepCaptureOrigins(area)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('disable removes the origin and is a no-op for an unstored one', async () => {
    await enableDeepCapture('https://a.com', area);
    await enableDeepCapture('https://b.com', area);
    await disableDeepCapture('https://a.com', area);
    expect(await getDeepCaptureOrigins(area)).toEqual(['https://b.com']);

    // No-op path.
    const before = await getDeepCaptureOrigins(area);
    await disableDeepCapture('https://never.com', area);
    expect(await getDeepCaptureOrigins(area)).toEqual(before);
  });

  it('refuses to persist a non-http(s) origin (defense in depth)', async () => {
    await expect(enableDeepCapture('chrome://settings', area)).rejects.toThrow();
  });

  it('drops garbage entries on read', async () => {
    await area.set({
      [DEEP_CAPTURE_ORIGINS_KEY]: ['https://good.com', 42, null, 'chrome://bad'],
    });
    expect(await getDeepCaptureOrigins(area)).toEqual(['https://good.com']);
  });

  it('isDeepCaptureEnabled returns false for a non-http(s) URL', async () => {
    expect(await isDeepCaptureEnabled('chrome://extensions', area)).toBe(false);
  });
});

describe('diffRemovedOrigins (storage.onChanged diff)', () => {
  it('returns origins present in oldValue but absent from newValue', () => {
    expect(
      diffRemovedOrigins(['https://a.com', 'https://b.com', 'https://c.com'], ['https://b.com']),
    ).toEqual(['https://a.com', 'https://c.com']);
  });

  it('returns [] when newValue is a superset (an enable event)', () => {
    expect(diffRemovedOrigins(['https://a.com'], ['https://a.com', 'https://b.com'])).toEqual([]);
  });

  it('treats undefined / non-array oldValue as empty', () => {
    expect(diffRemovedOrigins(undefined, [])).toEqual([]);
    expect(diffRemovedOrigins('garbage', ['https://a.com'])).toEqual([]);
  });

  it('treats undefined / non-array newValue as empty (every old origin counts as removed)', () => {
    expect(diffRemovedOrigins(['https://a.com', 'https://b.com'], undefined)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('ignores non-string entries in either side', () => {
    expect(
      diffRemovedOrigins(
        ['https://a.com', 42 as unknown as string, null as unknown as string],
        ['https://a.com'],
      ),
    ).toEqual([]);
  });
});
