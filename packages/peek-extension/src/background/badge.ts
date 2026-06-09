/**
 * The subset of `chrome.action` we drive for the recording badge. Declared as
 * an injectable interface so tests pass a fake surface (the codebase's
 * surface-injection idiom, e.g. DeepCaptureManager's DebuggerSurface).
 */
export interface ActionSurface {
  setBadgeText(details: { tabId: number; text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { tabId: number; color: string }): Promise<void>;
  setTitle(details: { tabId: number; title: string }): Promise<void>;
}

export const RECORDING_BADGE_TEXT = '●'; // ● filled dot
export const RECORDING_BADGE_COLOR = '#f87171'; // --peek-danger
export const RECORDING_TITLE = 'peek — recording this tab';
export const DEFAULT_TITLE = 'peek';

/**
 * Drive the per-tab toolbar badge to reflect recording state. Always-on when
 * recording (the un-spoofable, browser-chrome signal); independent of the
 * in-page-glow setting. Best-effort: a closed/missing tab throws, which we
 * swallow so a stale tabId never breaks the SW.
 */
export async function applyBadge(
  action: ActionSurface,
  tabId: number,
  recording: boolean,
): Promise<void> {
  try {
    if (recording) {
      await action.setBadgeText({ tabId, text: RECORDING_BADGE_TEXT });
      await action.setBadgeBackgroundColor({ tabId, color: RECORDING_BADGE_COLOR });
      await action.setTitle({ tabId, title: RECORDING_TITLE });
    } else {
      await action.setBadgeText({ tabId, text: '' });
      await action.setTitle({ tabId, title: DEFAULT_TITLE });
    }
  } catch {
    // Tab gone between derivation and the call — best effort.
  }
}
