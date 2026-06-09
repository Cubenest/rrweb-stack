import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addEnabledOrigin } from '../activation/storage';
import { RecordingStateStore, isTabRecording } from '../background/recording-state';
import { setPermissionLevel } from '../permissions/store';

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(() => {
  fakeBrowser.reset();
});

describe('isTabRecording', () => {
  it('is false for an undefined url', async () => {
    expect(await isTabRecording(undefined)).toBe(false);
  });

  it('is false when the origin is not enabled', async () => {
    expect(await isTabRecording('https://example.test/page')).toBe(false);
  });

  it('is true when the origin is enabled and the level is not 0', async () => {
    await addEnabledOrigin('https://example.test');
    expect(await isTabRecording('https://example.test/page')).toBe(true);
  });

  it('is false when the enabled origin is at level 0 (Off)', async () => {
    await addEnabledOrigin('https://example.test');
    await setPermissionLevel('https://example.test', 0);
    expect(await isTabRecording('https://example.test/page')).toBe(false);
  });
});

describe('RecordingStateStore', () => {
  it('defaults to not-recording and reports whether set/clear changed state', () => {
    const s = new RecordingStateStore();
    expect(s.get(1)).toBe(false);
    expect(s.set(1, true)).toBe(true); // changed
    expect(s.get(1)).toBe(true);
    expect(s.set(1, true)).toBe(false); // no change
    expect(s.clear(1)).toBe(true); // changed back
    expect(s.get(1)).toBe(false);
    expect(s.clear(1)).toBe(false); // already cleared
  });
});
