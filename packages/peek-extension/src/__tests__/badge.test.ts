import { describe, expect, it } from 'vitest';
import {
  type ActionSurface,
  DEFAULT_TITLE,
  RECORDING_BADGE_COLOR,
  RECORDING_BADGE_TEXT,
  RECORDING_TITLE,
  applyBadge,
} from '../background/badge';

function fakeAction(): { surface: ActionSurface; calls: string[] } {
  const calls: string[] = [];
  const surface: ActionSurface = {
    async setBadgeText({ tabId, text }) {
      calls.push(`text:${tabId}:${text}`);
    },
    async setBadgeBackgroundColor({ tabId, color }) {
      calls.push(`color:${tabId}:${color}`);
    },
    async setTitle({ tabId, title }) {
      calls.push(`title:${tabId}:${title}`);
    },
  };
  return { surface, calls };
}

describe('applyBadge', () => {
  it('sets badge text + color + title when recording', async () => {
    const { surface, calls } = fakeAction();
    await applyBadge(surface, 7, true);
    expect(calls).toEqual([
      `text:7:${RECORDING_BADGE_TEXT}`,
      `color:7:${RECORDING_BADGE_COLOR}`,
      `title:7:${RECORDING_TITLE}`,
    ]);
  });

  it('clears the badge text and restores the default title when not recording', async () => {
    const { surface, calls } = fakeAction();
    await applyBadge(surface, 7, false);
    expect(calls).toEqual(['text:7:', `title:7:${DEFAULT_TITLE}`]);
  });

  it('swallows errors from a closed/missing tab', async () => {
    const surface: ActionSurface = {
      async setBadgeText() {
        throw new Error('No tab with id: 99');
      },
      async setBadgeBackgroundColor() {},
      async setTitle() {},
    };
    await expect(applyBadge(surface, 99, true)).resolves.toBeUndefined();
  });
});
