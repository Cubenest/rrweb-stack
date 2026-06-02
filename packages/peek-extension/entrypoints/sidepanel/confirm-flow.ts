/**
 * Pure helpers for the side-panel Level-3 confirm flow (Task 3.24, Phase 3e).
 *
 * The React component (App.tsx) is a thin shell over these so the trust-
 * boundary + race logic unit-tests without a DOM:
 *
 *   • {@link isShowConfirmFromBackground} (item D-a) — only the extension's OWN
 *     background SW may surface a confirm banner. The side panel's
 *     `chrome.runtime.onMessage` listener fires for ANY runtime message,
 *     including ones a page / other extension context could post; without a
 *     sender check, such a context could inject a forged `showConfirm` and
 *     replace the pending action the user is about to approve.
 *
 *   • {@link ConfirmResolutionTracker} (item D-b) — guards the resolve↔cleanup
 *     race. `resolveConfirm` sets `pendingConfirm` to null, which fires the
 *     `[pendingConfirm]` effect CLEANUP, which would ALSO post
 *     `closedVerdict(requestId)` for the same request AFTER the user's verdict.
 *     A late synthetic deny must not override an allow the SW already acted on.
 *     We record resolved request ids and have the cleanup skip them.
 */

import { type ShowConfirmMessage, isShowConfirm } from '../../src/messaging/protocol';

/**
 * True iff `message` is a well-formed {@link ShowConfirmMessage} AND its sender
 * is the extension's own background SW (`sender.id === runtimeId`). Used by the
 * side panel's onMessage listener so only the SW can surface a confirm banner.
 *
 * Pure: the sender shape + the runtime id are injected (the call site passes
 * `chrome.runtime.id`), so this tests without a real browser.
 */
export function isShowConfirmFromBackground(
  message: unknown,
  sender: { id?: string | undefined },
  runtimeId: string,
): message is ShowConfirmMessage {
  if (sender.id !== runtimeId) return false;
  return isShowConfirm(message);
}

/**
 * Tracks which confirm requestIds already received a user verdict, so the
 * panel-unmount / pending-cleared cleanup does NOT send a second (deny) verdict
 * for them (item D-b). One instance per App mount (a ref), keyed by requestId.
 */
export class ConfirmResolutionTracker {
  readonly #resolved = new Set<string>();

  /** Record that a verdict was sent for `requestId` (Allow / Always / Deny). */
  markResolved(requestId: string): void {
    this.#resolved.add(requestId);
  }

  /**
   * Should the `[pendingConfirm]` cleanup post a `closedVerdict` for this
   * request? Only when NO verdict was already sent (a genuine panel close).
   * Returns false for an already-resolved id, so a late cleanup can't override
   * the user's choice with a synthetic deny.
   */
  shouldSendCloseVerdict(requestId: string): boolean {
    return !this.#resolved.has(requestId);
  }
}
