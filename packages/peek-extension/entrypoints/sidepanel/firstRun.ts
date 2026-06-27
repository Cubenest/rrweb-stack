// First-run orientation state for the side panel. A single chrome.storage.local
// boolean records whether the user has dismissed the one-time explainer card.
// Local (not sync): orientation is per-device and this avoids sync quota churn.
// On any read error we treat the card as already dismissed (show=false) so a
// returning user is never re-onboarded by a transient failure.

import { useEffect, useState } from 'react';

/** chrome.storage.local key holding the first-run dismissal flag. */
export const FIRST_RUN_DISMISSED_KEY = 'peek:firstRunDismissed';

/**
 * True only when the explainer has been explicitly dismissed.
 *
 * Distinguishes three cases so the hook can fail toward non-intrusive:
 *  - unset (`undefined`) → `false` (legitimate first run; show the card)
 *  - `true` → `true` (already dismissed; stay hidden)
 *  - anything else (malformed) → throw, so `useFirstRun`'s `.catch` keeps the
 *    card hidden rather than re-onboarding a returning user.
 */
export async function readFirstRunDismissed(): Promise<boolean> {
  const value = (await chrome.storage.local.get(FIRST_RUN_DISMISSED_KEY))[FIRST_RUN_DISMISSED_KEY];
  if (value === undefined) return false;
  if (value === true) return true;
  throw new Error('Unexpected first-run dismissal value');
}

/** Persist that the user dismissed the explainer. */
export async function writeFirstRunDismissed(): Promise<void> {
  await chrome.storage.local.set({ [FIRST_RUN_DISMISSED_KEY]: true });
}

export interface FirstRunControl {
  /** Whether the explainer should be shown (loaded AND not yet dismissed). */
  show: boolean;
  /** Dismiss the explainer (optimistic; persists in the background). */
  dismiss: () => void;
}

/**
 * Hook for the first-run explainer. Starts hidden, reads storage once, and
 * shows the card only if not yet dismissed. On a read error it stays hidden
 * (fail toward non-intrusive — never re-onboard on a transient failure).
 */
export function useFirstRun(): FirstRunControl {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let cancelled = false;
    readFirstRunDismissed()
      .then((dismissed) => {
        if (!cancelled) setShow(!dismissed);
      })
      .catch(() => {
        if (!cancelled) setShow(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const dismiss = (): void => {
    setShow(false);
    void writeFirstRunDismissed().catch(() => {
      // Best-effort: if the write fails the card reappears next open, which is
      // acceptable (better than a stuck card). No user-facing error needed.
    });
  };
  return { show, dismiss };
}
