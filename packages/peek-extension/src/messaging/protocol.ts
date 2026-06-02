/**
 * Typed message protocol between the four execution contexts (side panel,
 * background SW, ISOLATED relay, native host). WXT ships no messaging library
 * (per the WXT skill), so we hand-roll a small typed `sendCmd`.
 *
 * Chunk 3d-1 carried the shell commands (native-host status + a recorder-stats
 * placeholder). Chunk 3d-2 added the ISOLATED-relay → SW capture messages
 * (`recorder.events` / `recorder.shadow`) that the SW folds into per-tab
 * RecorderStats and forwards over the native port. Chunk 3d-3 added the
 * action-authorization + audit commands. Phase 5 / alpha.6 (Task #72) removed
 * the `recorder.net` channel — the rrweb network plugin emits its events on
 * `recorder.events` directly, and `network-plugin-synth.ts` synthesizes the
 * server-side `network.append` payloads from there.
 */

import type { Action } from '../permissions/action-protocol';

/**
 * SW → side panel: surface the Level-3 confirm banner for a pending action.
 * Sent via `chrome.runtime.sendMessage` after the SW opens the panel. The panel
 * renders {@link ConfirmBanner} and replies with a {@link ConfirmVerdictMessage}.
 */
export interface ShowConfirmMessage {
  type: 'showConfirm';
  /** Correlates the verdict back to the awaiting action request. */
  requestId: string;
  /** The action awaiting confirmation (drives the banner copy). */
  action: Action;
  /** Set when the destructive matcher fired — the banner shows a warning. */
  destructiveTerm?: string;
  /** The site the action targets (shown in the banner). */
  origin: string;
}

/**
 * Side panel → SW: the user's verdict for a pending confirm. `alwaysForSite`
 * (Allow + remember) bumps the origin to Level 4 / records an allow-list entry
 * (handled SW-side). A closed/timed-out panel never sends this — the SW
 * fail-closes to deny after its own timeout.
 */
export interface ConfirmVerdictMessage {
  type: 'confirmVerdict';
  requestId: string;
  verdict: 'allow' | 'deny';
  alwaysForSite?: boolean;
}

/** Live capture counters surfaced in the side panel (P2 PRD §D.3). */
export interface RecorderStats {
  domMutations: number;
  consoleLogs: number;
  networkRequests: number;
}

/** Connection state of the native-messaging port (ADR-0009 diagnostics). */
export type NativeHostState = 'connected' | 'disconnected' | 'reconnecting';

/** A masked console event the relay extracts from the rrweb console plugin. */
export interface RelayConsoleEvent {
  ts: number;
  level: string;
  /** Already PII-masked in the ISOLATED relay (mask.ts). */
  args: string[];
}

/**
 * A closed-shadow-root report from the ISOLATED relay (Task 3.21). Best-effort:
 * the relay notes WHERE closed/unreachable roots are so the native host /
 * replayer can flag the recording gap. We send a compact descriptor, not the
 * (potentially large, unmasked) shadow subtree HTML.
 */
export interface ShadowReport {
  /** A CSS-ish path to the host element, for human/debug correlation. */
  hostPath: string;
  /** How the root was resolved (mirrors ShadowRootInfo.source). */
  source: 'chrome.dom' | 'unreachable';
  mode: 'open' | 'closed' | 'unknown';
}

/**
 * Commands sent to the background SW. Two flavors:
 *   - query commands (side panel) that expect a typed response;
 *   - fire-and-forget capture batches (ISOLATED relay) that the SW acks.
 */
export type Cmd =
  | { type: 'getNativeHostState' }
  | { type: 'getRecorderStats'; tabId: number }
  // Side panel → SW. Fired after `requestActivation(url, 'tab')` returns granted
  // for an activeTab-scope grant. The chrome.tabs.onUpdated / storage.onChanged
  // listeners that normally trigger injection don't fire for activeTab grants
  // on an already-loaded page, so the side panel asks the SW to inject directly.
  | { type: 'activateRecorderForTab'; tabId: number }
  // ISOLATED relay → SW. `tabId` is filled by the SW from `sender.tab.id` (the
  // relay can't know its own tab id), so it's not on the wire shape.
  | { type: 'recorder.events'; events: unknown[]; console: RelayConsoleEvent[] }
  | { type: 'recorder.shadow'; reports: ShadowReport[] };

/**
 * Result the SW returns from {@link Cmd}'s `activateRecorderForTab`.
 * `ok: true` means `chrome.scripting.executeScript` returned without error
 * (the in-page idempotency guard handles double-inject safely); `ok: false`
 * carries the reason so the side panel can degrade — but does not surface as a
 * user error, since the activeTab grant itself already succeeded.
 */
export interface ActivateRecorderResult {
  ok: boolean;
  reason?: string;
}

/** A generic ack for fire-and-forget relay messages. */
export interface RelayAck {
  ok: boolean;
  /** Present when ok=false: why the SW couldn't accept the batch. */
  reason?: string;
}

/** Per-command response types. */
export type CmdResponse<C extends Cmd> = C extends { type: 'getNativeHostState' }
  ? { state: NativeHostState }
  : C extends { type: 'getRecorderStats' }
    ? RecorderStats
    : C extends { type: 'activateRecorderForTab' }
      ? ActivateRecorderResult
      : C extends { type: 'recorder.events' | 'recorder.shadow' }
        ? RelayAck
        : never;

/**
 * Error thrown by {@link sendCmd} when the SW can't be reached.
 *
 * Carry-in [10]: `chrome.runtime.sendMessage` rejects with "Could not establish
 * connection. Receiving end does not exist." when the SW is asleep / absent.
 * Left unhandled that's an unhandled promise rejection at every call site. We
 * normalize it to this typed error so callers can `catch` and degrade (the side
 * panel falls back to zero stats; the relay drops the batch and retries later).
 */
export class ServiceWorkerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('peek: background service worker is not reachable');
    this.name = 'ServiceWorkerUnavailableError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * Heuristic: is this rejection the "SW not running / no receiver" case (vs a
 * genuine handler error we should surface)? Chrome phrases it a few ways across
 * versions; match on the stable fragments.
 */
export function isNoReceiverError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('Receiving end does not exist') ||
    msg.includes('Could not establish connection') ||
    msg.includes('message port closed')
  );
}

/**
 * Send a typed command to the background service worker.
 *
 * Throws {@link ServiceWorkerUnavailableError} when the SW is unreachable (a
 * normal, recoverable condition in MV3), so callers handle one typed error
 * instead of an opaque unhandled rejection. Other handler errors propagate
 * as-is.
 */
export async function sendCmd<C extends Cmd>(cmd: C): Promise<CmdResponse<C>> {
  try {
    return (await chrome.runtime.sendMessage(cmd)) as CmdResponse<C>;
  } catch (err) {
    if (isNoReceiverError(err)) {
      throw new ServiceWorkerUnavailableError(err);
    }
    throw err;
  }
}

/** Empty/zero stats — the value shown before any capture has been folded in. */
export const EMPTY_RECORDER_STATS: RecorderStats = {
  domMutations: 0,
  consoleLogs: 0,
  networkRequests: 0,
};

/** Type guard: is this inbound runtime message a {@link ShowConfirmMessage}? */
export function isShowConfirm(message: unknown): message is ShowConfirmMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'showConfirm'
  );
}

/** Post a confirm verdict back to the SW. Best-effort; SW fail-closes on no reply. */
export async function sendConfirmVerdict(verdict: ConfirmVerdictMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(verdict);
  } catch (err) {
    // The SW may have died (MVP decision: SW-death during a pending confirm =
    // timeout→deny). Swallow — the SW's own timeout handles it.
    if (!isNoReceiverError(err)) throw err;
  }
}
