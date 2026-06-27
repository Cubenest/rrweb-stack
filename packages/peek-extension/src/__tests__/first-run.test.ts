import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIRST_RUN_DISMISSED_KEY,
  readFirstRunDismissed,
  writeFirstRunDismissed,
} from '../../entrypoints/sidepanel/firstRun';

beforeEach(() => fakeBrowser.reset());
afterEach(() => fakeBrowser.reset());

describe('first-run dismissal state', () => {
  it('reads false when nothing is stored', async () => {
    expect(await readFirstRunDismissed()).toBe(false);
  });

  it('round-trips a dismissal through storage.local', async () => {
    await writeFirstRunDismissed();
    expect(await readFirstRunDismissed()).toBe(true);
  });

  it('throws on a malformed stored value (so the hook fails toward hidden, not re-onboarding)', async () => {
    await fakeBrowser.storage.local.set({ [FIRST_RUN_DISMISSED_KEY]: 'yes' });
    await expect(readFirstRunDismissed()).rejects.toThrow();
  });
});
