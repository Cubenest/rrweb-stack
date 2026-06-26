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

  it('reads false (fail toward non-intrusive) when the stored value is not a boolean true', async () => {
    await fakeBrowser.storage.local.set({ [FIRST_RUN_DISMISSED_KEY]: 'yes' });
    expect(await readFirstRunDismissed()).toBe(false);
  });
});
