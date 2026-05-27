/**
 * Typed message protocol between the four execution contexts (side panel,
 * background SW, ISOLATED relay, native host). WXT ships no messaging library
 * (per the WXT skill), so we hand-roll a small typed `sendCmd`.
 *
 * This is intentionally minimal for chunk 3d-1 — it carries the commands the
 * shell needs (native-host connection status + a recorder-stats placeholder).
 * Chunk 3d-2 adds the recorder relay events; chunk 3d-3 adds the
 * action-authorization + audit commands. Extend the `Cmd` union here.
 */

/** Live capture counters surfaced in the side panel (P2 PRD §D.3). */
export interface RecorderStats {
  domMutations: number;
  consoleLogs: number;
  networkRequests: number;
}

/** Connection state of the native-messaging port (ADR-0009 diagnostics). */
export type NativeHostState = 'connected' | 'disconnected' | 'reconnecting';

/** Commands the side panel / content scripts send to the background SW. */
export type Cmd = { type: 'getNativeHostState' } | { type: 'getRecorderStats'; tabId: number };

/** Per-command response types. */
export type CmdResponse<C extends Cmd> = C extends { type: 'getNativeHostState' }
  ? { state: NativeHostState }
  : C extends { type: 'getRecorderStats' }
    ? RecorderStats
    : never;

/** Send a typed command to the background service worker. */
export async function sendCmd<C extends Cmd>(cmd: C): Promise<CmdResponse<C>> {
  return (await chrome.runtime.sendMessage(cmd)) as CmdResponse<C>;
}

/** Empty/zero stats — the placeholder value until the recorder relay lands (3d-2). */
export const EMPTY_RECORDER_STATS: RecorderStats = {
  domMutations: 0,
  consoleLogs: 0,
  networkRequests: 0,
};
