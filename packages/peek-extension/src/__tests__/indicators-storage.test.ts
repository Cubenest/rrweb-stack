import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHOW_RECORDING_BORDER_KEY,
  type StorageAreaLike,
  getShowRecordingBorder,
  setShowRecordingBorder,
} from '../indicators/storage';

const area = fakeBrowser.storage.sync as unknown as StorageAreaLike;

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(() => {
  fakeBrowser.reset();
});

describe('recording-border setting', () => {
  it('defaults to true when unset (fail toward showing the consent signal)', async () => {
    expect(await getShowRecordingBorder(area)).toBe(true);
  });

  it('round-trips false', async () => {
    await setShowRecordingBorder(false, area);
    expect(await getShowRecordingBorder(area)).toBe(false);
  });

  it('round-trips back to true', async () => {
    await setShowRecordingBorder(false, area);
    await setShowRecordingBorder(true, area);
    expect(await getShowRecordingBorder(area)).toBe(true);
  });

  it('treats a null / non-boolean stored value as true (fail toward showing)', async () => {
    await area.set({ [SHOW_RECORDING_BORDER_KEY]: null });
    expect(await getShowRecordingBorder(area)).toBe(true);

    await area.set({ [SHOW_RECORDING_BORDER_KEY]: 1 });
    expect(await getShowRecordingBorder(area)).toBe(true);
  });
});
