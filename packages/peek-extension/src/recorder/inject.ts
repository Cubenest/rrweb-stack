/**
 * MAIN-world recorder injection (Task 3.19, P2 PRD §A.2).
 *
 * On a per-site-enabled tab, the SW dynamically injects `rrweb-recorder.js`
 * (the esbuild IIFE) into the page's MAIN world at document_start so rrweb sees
 * the initial DOM. The ISOLATED relay (`isolated-relay.content.ts`) is a static
 * content script that loads on its own at document_start to receive what the
 * recorder posts.
 *
 * The injection itself is a `chrome.scripting` side effect (E2E-tested in
 * Phase 3e). Kept thin and typed here so the SW call site is small and the
 * carry-in [10] error handling (don't throw on a tab we can't inject into)
 * lives in one place.
 */

import { RECORDER_FILE } from '../constants.js';

export interface InjectResult {
  ok: boolean;
  tabId: number;
  /** Present when `ok === false`: why injection failed (host perm, chrome:// tab, …). */
  error?: string;
}

/** Minimal slice of `chrome.scripting` we depend on (keeps this unit-mockable). */
export interface ScriptingLike {
  executeScript(injection: {
    target: { tabId: number; allFrames?: boolean };
    world?: 'MAIN' | 'ISOLATED';
    injectImmediately?: boolean;
    files?: string[];
  }): Promise<unknown>;
}

function scripting(): ScriptingLike {
  return chrome.scripting as unknown as ScriptingLike;
}

/**
 * Inject the MAIN-world recorder into every frame of `tabId`.
 *
 * `injectImmediately: true` is the best-effort document_start hook for a
 * dynamic injection (§A.2) — rrweb needs an early start to capture the full
 * initial snapshot. Failures (no host grant for the tab's origin, a
 * restricted page, the tab having navigated away) are returned, never thrown:
 * the SW injects opportunistically and must not crash on an un-injectable tab.
 */
export async function injectRecorder(
  tabId: number,
  api: ScriptingLike = scripting(),
): Promise<InjectResult> {
  try {
    await api.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      injectImmediately: true,
      files: [RECORDER_FILE],
    });
    return { ok: true, tabId };
  } catch (err) {
    return {
      ok: false,
      tabId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
