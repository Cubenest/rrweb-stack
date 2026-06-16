/** `chrome.storage.sync` key for the in-page recording-border (glow) toggle. */
export const SHOW_RECORDING_BORDER_KEY = 'peek:showRecordingBorder';

/** Subset of `chrome.storage.StorageArea` we depend on (injectable for tests). */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function syncArea(): StorageAreaLike {
  // Resolve at call time so the fake can be installed first in tests and the SW
  // picks up the real API on wake (matches activation/storage.ts).
  return chrome.storage.sync as unknown as StorageAreaLike;
}

/**
 * Read the toggle. Defaults to TRUE: the glow is on by default, and an
 * unreadable/missing value fails toward showing the consent signal.
 */
export async function getShowRecordingBorder(area: StorageAreaLike = syncArea()): Promise<boolean> {
  const rec = await area.get(SHOW_RECORDING_BORDER_KEY);
  const v = rec[SHOW_RECORDING_BORDER_KEY];
  return v !== false;
}

/** Persist the toggle. */
export async function setShowRecordingBorder(
  value: boolean,
  area: StorageAreaLike = syncArea(),
): Promise<void> {
  await area.set({ [SHOW_RECORDING_BORDER_KEY]: value });
}

/** `chrome.storage.sync` key for the in-page action-feedback toggle. */
export const SHOW_ACTION_FEEDBACK_KEY = 'peek:showActionFeedback';

/**
 * Read the action-feedback toggle. Defaults to TRUE: the cue is on by default,
 * and an unreadable/missing value fails toward showing it.
 */
export async function getShowActionFeedback(area: StorageAreaLike = syncArea()): Promise<boolean> {
  const rec = await area.get(SHOW_ACTION_FEEDBACK_KEY);
  const v = rec[SHOW_ACTION_FEEDBACK_KEY];
  return v !== false;
}

/** Persist the action-feedback toggle. */
export async function setShowActionFeedback(
  value: boolean,
  area: StorageAreaLike = syncArea(),
): Promise<void> {
  await area.set({ [SHOW_ACTION_FEEDBACK_KEY]: value });
}
