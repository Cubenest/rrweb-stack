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
  selector: string;
  nth?: number;
  button: 'left' | 'middle' | 'right';
}
export interface TypeAction {
  type: 'type';
  selector: string;
  text: string;
  delay: number;
}
export interface NavigateAction {
  type: 'navigate';
  url: string;
}
export interface BackAction {
  type: 'back';
}
export interface ForwardAction {
  type: 'forward';
}
export interface ReloadAction {
  type: 'reload';
}
export interface ScrollAction {
  type: 'scroll';
  selector?: string;
  x?: number;
  y?: number;
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

export type Action =
  | ClickAction
  | TypeAction
  | NavigateAction
  | BackAction
  | ForwardAction
  | ReloadAction
  | ScrollAction
  | ScreenshotAction
  | WaitForAction;

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
  approver: 'user' | 'allow-list-match' | 'level-4-auto';
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
