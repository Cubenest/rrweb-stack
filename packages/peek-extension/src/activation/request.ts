/**
 * Per-site activation request flow (ADR-0008, P2 PRD §A.4 / §D.1).
 *
 * MUST be called from a user-gesture handler (a click in the side panel) —
 * `chrome.permissions.request` only works inside a gesture. The side panel's
 * "Enable on this site" button is that gesture (see entrypoints/sidepanel).
 *
 * Flow:
 *   1. Derive the origin + match pattern from the active tab URL.
 *   2. For scope "origin": request `chrome.permissions.request({ origins })`.
 *      For scope "tab": rely on `activeTab` — no host grant requested.
 *   3. On grant, persist the origin to `chrome.storage.sync`.
 *
 * NOTE (chunk boundary): dynamic MAIN-world rrweb injection on grant is chunk
 * 3d-2. This module deliberately stops at "permission granted + persisted" and
 * exposes the result so the injection step slots in at the call site without
 * reworking the gesture handling.
 */

import { type ActivationScope, deriveActivationRequest } from './origin';
import { addEnabledOrigin } from './storage';

export interface ActivationResult {
  /** The bare origin the request targeted (`https://example.com`). */
  origin: string;
  /** The scope the user chose. */
  scope: ActivationScope;
  /** Whether the host permission was granted (always true for `scope: 'tab'`). */
  granted: boolean;
  /** Whether the origin was persisted to storage.sync (only on origin-scope grants). */
  persisted: boolean;
}

/**
 * Execute the activation request for a tab URL + chosen scope.
 *
 * @throws if the URL is not an activatable http(s) origin.
 */
export async function requestActivation(
  url: string | undefined | null,
  scope: ActivationScope,
): Promise<ActivationResult> {
  const derived = deriveActivationRequest(url, scope);
  if (!derived) {
    throw new Error(`cannot activate on non-http(s) URL: ${url ?? '(none)'}`);
  }
  const { origin, origins } = derived;

  // "Just this tab" — historically assumed `activeTab` covered the current tab
  // without any prompt. That's only true when the gesture is an action-icon
  // click; side-panel button clicks DON'T grant activeTab, so subsequent
  // `chrome.scripting.executeScript` calls refuse with "Extension manifest
  // must request permission to access this host." Request the origin pattern
  // like "All tabs" does, but DON'T persist to `enabledOrigins` — the user
  // keeps "tab-scoped in practice" semantics: the host perm stays at the
  // Chrome level until they revoke it in chrome://extensions, but the SW
  // won't auto-restore recording on new tabs of this origin because nothing
  // went into storage.
  if (scope === 'tab') {
    const grantedTab = await chrome.permissions.request({ origins });
    return { origin, scope, granted: grantedTab, persisted: false };
  }

  // "All tabs on this domain" → request the broad-but-scoped origin pattern
  // from the gesture, then persist on grant so the SW's storage.onChanged
  // listener auto-restores recording on future tabs (P-11 fix).
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    return { origin, scope, granted: false, persisted: false };
  }
  await addEnabledOrigin(origin);
  return { origin, scope, granted: true, persisted: true };
}
