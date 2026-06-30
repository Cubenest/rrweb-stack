/**
 * Native-host ↔ SW action-request wire shapes — extension-side mirror of
 * peek-mcp/src/native-host/action-protocol.ts (Task 3.24).
 *
 * Duplicated rather than imported because @peekdev/mcp is a node-only package
 * and the extension build can't pull in `node:` imports. The two definitions
 * are SHAPE-mirror; a structural mismatch would be a test failure on the
 * server side (server.test.ts asserts the request shape it sends).
 */

/** A typed shape for an Action (mirrors the zod schema in peek-mcp). */
export interface ClickAction {
  type: 'click';
  /** Target by `ref` (from get_page_view) or `selector`; one required (enforced at dispatch). */
  ref?: string;
  selector?: string;
  nth?: number;
  button: 'left' | 'middle' | 'right';
  /** R2: when true, the SW appends a `details.viewDelta` diff after the action lands. */
  observe?: boolean;
}
export interface TypeAction {
  type: 'type';
  ref?: string;
  selector?: string;
  text: string;
  delay: number;
  observe?: boolean;
}
export interface NavigateAction {
  type: 'navigate';
  url: string;
  observe?: boolean;
}
export interface BackAction {
  type: 'back';
  observe?: boolean;
}
export interface ForwardAction {
  type: 'forward';
  observe?: boolean;
}
export interface ReloadAction {
  type: 'reload';
  observe?: boolean;
}
export interface ScrollAction {
  type: 'scroll';
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
  observe?: boolean;
}
export interface ScreenshotAction {
  type: 'screenshot';
  selector?: string;
}
export interface WaitForAction {
  type: 'waitFor';
  selector?: string;
  timeoutMs: number;
}
export interface EnterAction {
  type: 'enter';
  ref?: string;
  selector?: string;
  observe?: boolean;
}
export interface DblClickAction {
  type: 'dblclick';
  ref?: string;
  selector?: string;
  nth?: number;
  observe?: boolean;
}
export interface HighlightAction {
  type: 'highlight';
  selector: string;
  label?: string;
}
export interface ClearHighlightAction {
  type: 'clear_highlight';
}
/** Plan B — input handoff. selector optional; readBack/timeoutMs carried for the SW. */
export interface RequestUserInputAction {
  type: 'request_user_input';
  prompt: string;
  selector?: string;
  scope?: 'field' | 'page';
  readBack?: boolean;
  timeoutMs?: number;
}
/** Part 2 — sets the operator-facing intent banner text for the session. */
export interface SetIntentAction {
  type: 'set_intent';
  text: string;
  /** Terminal-of-loop status (Slice B). Absent = ongoing label. */
  status?: 'done' | 'failed';
}
/** R1 — live page-view snapshot (non-mutating read). Returns nodes in `details`. */
export interface PageViewAction {
  type: 'page_view';
  selector?: string;
  maxElements?: number;
}
/** R2 — single-element drill-in (non-mutating read). Resolves `ref` → masked detail in `details`. */
export interface ElementDetailAction {
  type: 'element_detail';
  ref: string;
}

export type Action =
  | ClickAction
  | TypeAction
  | NavigateAction
  | BackAction
  | ForwardAction
  | ReloadAction
  | ScrollAction
  | ScreenshotAction
  | WaitForAction
  | EnterAction
  | DblClickAction
  | HighlightAction
  | ClearHighlightAction
  | RequestUserInputAction
  | SetIntentAction
  | PageViewAction
  | ElementDetailAction;

/** host → SW: please run / authorize this action. */
export interface ActionRequestMessage {
  type: 'action.request';
  requestId: string;
  tool: 'execute_action' | 'request_authorization';
  sessionId: string;
  action: Action;
  client: string;
  policy: {
    add: readonly string[];
    remove: readonly string[];
  };
  tabId?: number;
  /**
   * Pre-issued one-shot token from a prior `request_authorization`; lets the SW
   * skip the banner when it matches this request's (sessionId, action.type).
   */
  confirmToken?: string;
}

/** SW → host: optional timing signal when the banner is shown. */
export interface ActionConfirmShownMessage {
  type: 'action.confirm.shown';
  requestId: string;
  shownAtMs: number;
}

/** SW → host: terminal verdict + result. */
export interface ActionResultMessage {
  type: 'action.result';
  requestId: string;
  tool: 'execute_action' | 'request_authorization';
  verdict: 'allow' | 'deny';
  result: 'ok' | 'denied' | 'error';
  approver: 'user' | 'allow-list-match' | 'level-4-auto' | 'level-2-suggest' | 'level-1-read';
  approvalMs?: number;
  destructiveTerm?: string;
  details?: unknown;
  error?: string;
  /** request_authorization replies attach a one-shot token here. */
  confirmToken?: string;
}

/** Discriminator helper for the SW's native-port handleHostMessage. */
export function isActionRequest(message: unknown): message is ActionRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type: unknown }).type === 'action.request'
  );
}
