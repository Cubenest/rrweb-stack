// Native-host ↔ SW action-request wire protocol (Task 3.24).
//
// This is a NEW message-type catalog on top of the existing native-port
// channel. The capture-pipeline messages (`session.append`, `console.append`,
// `network.append`, `shadow.report`) are fire-and-forget INGEST traffic from
// the SW; the action messages here are CORRELATED REQUEST/RESPONSE traffic
// initiated by the host (an MCP tool call) and answered by the SW (after the
// MAIN-world dispatcher runs + possibly a side-panel banner).
//
// Correlation: every request carries a `requestId` (UUID). The SW echoes it on
// its reply; the host's `RequestRegistry` matches reply → pending tool handler.
//
// Three message types:
//
//   action.request  (host → SW)
//     Asks the SW to execute (or seek confirmation for) `action`. The host
//     attaches:
//       - `tool` so the SW knows whether this is execute_action or
//         request_authorization (banner copy / audit shape differ).
//       - `policy` — the destructive add/remove deltas from ~/.peek/policy.json
//         so the MAIN-world dispatcher merges them at decision time.
//       - `tabId` (optional) — when the tool args identify a session whose
//         active tab the host knows, the SW resolves to that tab; otherwise
//         the SW picks the active tab in the focused window.
//
//   action.confirm  (host ↔ SW)
//     OPTIONAL intermediate signal. The SW emits it when it surfaces the
//     side-panel banner so the host (and the audit log) can record the time
//     the user was prompted. NOT a correlation step — the verdict still
//     arrives in action.result.
//
//   action.result   (SW → host)
//     Terminal reply: `verdict` + `result` + `details`. The host's pending
//     RequestRegistry entry resolves with this payload.

import type { Action } from '../mcp/action-schema.js';

/** SW → host: a verdict + result payload for a previously-issued request. */
export interface ActionResultMessage {
  type: 'action.result';
  requestId: string;
  /** Mirrored from action.request so the audit log can fold it back together. */
  tool: 'execute_action' | 'request_authorization';
  /** What the gate decided + (for Level 3) what the user clicked. */
  verdict: 'allow' | 'deny';
  /** Final result of the dispatch (or 'denied' if verdict='deny'). */
  result: 'ok' | 'denied' | 'error';
  /** 'user' | 'allow-list-match' | 'level-4-auto'. */
  approver: 'user' | 'allow-list-match' | 'level-4-auto';
  /** ms-since-epoch when the user confirmed / denied (Level 3). */
  approvalMs?: number;
  /** The destructive term that fired, if applicable (for the audit log). */
  destructiveTerm?: string;
  /** Free-form detail (error message / screenshot dataURL / etc.). */
  details?: unknown;
  /** Error message when `result === 'error'` or 'denied'. */
  error?: string;
  /**
   * A one-shot confirm token issued on a `request_authorization` reply. The
   * relay carries it back to the MCP process so the AI can pass it to a later
   * `execute_action` (mirrors the extension-side ActionResultMessage).
   */
  confirmToken?: string;
}

/** host → SW: please execute / authorize this action. */
export interface ActionRequestMessage {
  type: 'action.request';
  requestId: string;
  tool: 'execute_action' | 'request_authorization';
  sessionId: string;
  action: Action;
  /** MCP client name from clientInfo (for audit-log "approver context"). */
  client: string;
  /** Destructive-term deltas from ~/.peek/policy.json (forwarded to the dispatcher). */
  policy: {
    add: readonly string[];
    remove: readonly string[];
  };
  /** Optional pinning to a specific tab id (SW picks active when omitted). */
  tabId?: number;
  /**
   * Pre-issued one-shot token from a prior `request_authorization` call. When
   * present and valid (matching this request's sessionId + action.type), the SW
   * consumes it and skips the side-panel banner. NULL/undefined → no token; the
   * banner runs.
   */
  confirmToken?: string;
}

/** SW → host: the banner is now visible to the user (timing signal). */
export interface ActionConfirmShownMessage {
  type: 'action.confirm.shown';
  requestId: string;
  /** ms-since-epoch the SW posted the banner. */
  shownAtMs: number;
}

export type HostToSwMessage = ActionRequestMessage;
export type SwToHostMessage = ActionResultMessage | ActionConfirmShownMessage;
