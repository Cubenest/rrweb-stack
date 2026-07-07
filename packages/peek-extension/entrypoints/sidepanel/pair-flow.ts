/**
 * Pure helpers for the side-panel SP4 pairing flow (Task 5).
 *
 * Mirrors {@link confirm-flow.ts} in purpose: the React component (App.tsx) is
 * a thin shell over these so the trust-boundary logic unit-tests without a DOM.
 *
 *   • {@link isShowPairFromBackground} — only the extension's OWN background SW
 *     may surface a pairing banner. Same rationale as `isShowConfirmFromBackground`:
 *     any runtime message can arrive here; without a sender check, a page context
 *     could inject a forged `showPair` and trick the user into pairing.
 */

import { type ShowPairMessage, isShowPair } from '../../src/messaging/protocol';

/**
 * True iff `message` is a well-formed {@link ShowPairMessage} AND its sender
 * is the extension's own background SW (`sender.id === runtimeId`). Used by the
 * side panel's onMessage listener so only the SW can surface a pairing banner.
 *
 * Pure: the sender shape + the runtime id are injected (the call site passes
 * `chrome.runtime.id`), so this tests without a real browser.
 */
export function isShowPairFromBackground(
  message: unknown,
  sender: { id?: string | undefined },
  runtimeId: string,
): message is ShowPairMessage {
  if (sender.id !== runtimeId) return false;
  return isShowPair(message);
}
