/**
 * Background-SW action handler (Task 3.24).
 *
 * The handler ties together:
 *   - per-origin permission level lookup (store.ts)
 *   - YOLO Level-4 in-memory state (yolo.ts)
 *   - the gating decision (gate.ts)
 *   - the dispatch-time destructive check (destructive.ts) — happens in the
 *     MAIN-world dispatcher, not here; this handler accepts the result.
 *   - confirm-token issuance / consumption (this module)
 *
 * The actual chrome.scripting.executeScript dispatch + side-panel banner UX
 * are E2E-deferred (the brief calls these out as Phase 3e). This module is the
 * *pure* part — tab resolution + level lookup + verdict + token bookkeeping —
 * so the logic is unit-testable without a real browser. The SW's
 * background.ts entrypoint calls `handleActionRequest(...)` from its native-
 * port handler and forwards the result back through the port.
 */

import { isOriginEnabled } from '../activation/storage.js';
import type { Action, ActionRequestMessage, ActionResultMessage } from './action-protocol.js';
import { isDestructive } from './destructive.js';
import { gate } from './gate.js';
import { getPermissionLevel } from './store.js';
import type { YoloSessionStore } from './yolo.js';

/**
 * The minimal `chrome.tabs.Tab` shape we need to resolve a request to a tab.
 * Injectable for tests — we don't want chrome global types in pure logic.
 *
 * Property types include `| undefined` so a real `chrome.tabs.Tab` (whose
 * fields are `number | undefined` rather than optional-key) is assignable
 * under `exactOptionalPropertyTypes`.
 */
export interface TabRef {
  id?: number | undefined;
  url?: string | undefined;
  title?: string | undefined;
  active?: boolean | undefined;
}

/** A confirm-token issuance: one-shot, bound to a session + action shape. */
export interface ConfirmToken {
  /** Opaque token string (UUID). */
  token: string;
  /** Session this token was issued for. */
  sessionId: string;
  /** Action-type the token was issued for (so a token isn't transferable). */
  actionType: Action['type'];
  /** ms-since-epoch when the token was issued. */
  issuedAtMs: number;
  /** ms-since-epoch when the token expires (issuedAt + ttlMs). */
  expiresAtMs: number;
}

/** TTL for an unused confirm token. 2 minutes — same as the brief's default-deny window. */
export const CONFIRM_TOKEN_TTL_MS = 2 * 60_000;

export interface ConfirmTokenStore {
  /** Issue a fresh token for `sessionId` + `actionType` + an expiry tick. */
  issue(sessionId: string, actionType: Action['type']): ConfirmToken;
  /**
   * Consume a token. Returns the token record if the token is valid and
   * matches the (sessionId, actionType) pair; returns null otherwise (unknown,
   * already-used, expired, mismatched).
   */
  consume(
    token: string,
    sessionId: string,
    actionType: Action['type'],
    nowMs?: number,
  ): ConfirmToken | null;
}

export interface ConfirmTokenStoreDeps {
  generateToken(): string;
  now(): number;
}
export const defaultConfirmTokenDeps: ConfirmTokenStoreDeps = {
  generateToken: () =>
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `tok-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  now: () => Date.now(),
};

/** In-memory implementation of {@link ConfirmTokenStore}. */
export class InMemoryConfirmTokenStore implements ConfirmTokenStore {
  readonly #tokens = new Map<string, ConfirmToken>();
  readonly #deps: ConfirmTokenStoreDeps;

  constructor(deps: ConfirmTokenStoreDeps = defaultConfirmTokenDeps) {
    this.#deps = deps;
  }

  issue(sessionId: string, actionType: Action['type']): ConfirmToken {
    const token = this.#deps.generateToken();
    const now = this.#deps.now();
    const record: ConfirmToken = {
      token,
      sessionId,
      actionType,
      issuedAtMs: now,
      expiresAtMs: now + CONFIRM_TOKEN_TTL_MS,
    };
    this.#tokens.set(token, record);
    return record;
  }

  consume(
    token: string,
    sessionId: string,
    actionType: Action['type'],
    nowMs?: number,
  ): ConfirmToken | null {
    const record = this.#tokens.get(token);
    if (!record) return null;
    // One-shot: remove regardless of whether the rest of the check passes,
    // so a malicious AI can't re-use a token by retrying with the right args.
    this.#tokens.delete(token);
    const now = nowMs ?? this.#deps.now();
    if (now > record.expiresAtMs) return null;
    if (record.sessionId !== sessionId) return null;
    if (record.actionType !== actionType) return null;
    return record;
  }

  /** Diagnostic: number of unconsumed tokens. */
  get size(): number {
    return this.#tokens.size;
  }
}

/** A target the destructive matcher will inspect. */
export interface DispatchTarget {
  /** Innermost element matching the action's selector (or null when N/A). */
  text?: string | null;
  ariaLabel?: string | null;
  nearbyHeading?: string | null;
}

/** Dependencies the {@link handleActionRequest} needs (all injectable). */
export interface ActionHandlerDeps {
  /** Look up `Tab` for the request's `tabId`, or the active tab. */
  getTabFor(request: ActionRequestMessage): Promise<TabRef | undefined>;
  /** Read the YOLO map (in-memory, MV3 SW-instance scoped). */
  yolo: YoloSessionStore;
  /** Token bookkeeping. */
  tokens: ConfirmTokenStore;
  /**
   * Surface the side-panel banner + await the user's verdict. Returns null on
   * timeout / panel closure (default-deny).
   */
  promptUserConfirmation(input: {
    request: ActionRequestMessage;
    origin: string;
    target: DispatchTarget;
    destructive: { matched: boolean; term?: string };
  }): Promise<
    | { verdict: 'allow' | 'deny'; approvalMs: number; alwaysForSite?: boolean }
    | { verdict: 'deny'; approvalMs: number; reason: 'timeout' | 'panel-closed' }
  >;
  /**
   * Resolve the dispatch target (text / aria-label / nearby heading) in the
   * MAIN-world tab. For actions without a selector (back/forward/reload), this
   * resolves to an empty target — the destructive matcher won't fire.
   */
  resolveTarget(input: { tabId: number; action: Action }): Promise<DispatchTarget>;
  /**
   * Actually dispatch the action in MAIN-world. Called only after the gate
   * returns `allow`. Returns the result the host gets back.
   */
  dispatchInMainWorld(input: {
    tabId: number;
    action: Action;
  }): Promise<{ ok: true; details?: unknown } | { ok: false; error: string }>;
  /** Resolve an origin string for the active tab. */
  originForTab?(tab: TabRef): string | null;
}

/** Default `originForTab` that uses the activation/origin module. */
import { originFromUrl } from '../activation/origin.js';
const defaultOriginForTab = (tab: TabRef): string | null => originFromUrl(tab.url ?? null);

/**
 * Handle a single inbound `action.request`. Pure-ish: every side effect goes
 * through {@link ActionHandlerDeps} so tests inject fakes.
 *
 * Decision flow:
 *   1. Resolve the target tab + origin.
 *      Bail with `deny + 'not authorized'` if there's no enabled origin (per
 *      ADR-0010 Level 0 also bails the recording path; for an explicit
 *      execute_action against a site that has NEVER been enabled, deny).
 *   2. Read the persistent level + check YOLO override.
 *      YOLO active → effective level = 4; else effective = persistent.
 *   3. Resolve the dispatch target (text/aria-label/nearby heading) via the
 *      MAIN-world resolver.
 *   4. Run the destructive matcher with the effective policy.
 *   5. gate({ level, destructive }) → 'allow' | 'confirm' | 'deny'.
 *      - deny: return ActionResultMessage with result='denied'.
 *      - allow (Level 4 non-destructive): for execute_action, dispatch
 *        immediately; for request_authorization, issue a token + return ok.
 *      - confirm: for request_authorization, surface the banner; for
 *        execute_action, surface the banner AND require the user click
 *        Allow (a prior token is consumable to skip the banner — but only
 *        if it MATCHES the current action; tokens are one-shot bound to
 *        (sessionId, actionType)).
 */
export async function handleActionRequest(
  request: ActionRequestMessage,
  deps: ActionHandlerDeps,
): Promise<ActionResultMessage> {
  const tab = await deps.getTabFor(request);
  if (!tab || tab.id === undefined) {
    return result(request, 'deny', 'denied', {
      approver: 'user',
      error: 'no active tab to dispatch into',
    });
  }
  const originResolver = deps.originForTab ?? defaultOriginForTab;
  const origin = originResolver(tab);
  if (!origin) {
    return result(request, 'deny', 'denied', {
      approver: 'user',
      error: 'active tab has no http(s) origin',
    });
  }

  const enabled = await isOriginEnabled(tab.url ?? origin);
  if (!enabled) {
    // Per ADR-0010, an unactivated site can never be acted on.
    return result(request, 'deny', 'denied', {
      approver: 'user',
      error: `origin not enabled for recording: ${origin}`,
    });
  }

  const persistentLevel = await getPermissionLevel(origin);
  const yoloActive = deps.yolo.isActive(origin);
  const effectiveLevel = yoloActive ? 4 : persistentLevel;

  const target = await deps.resolveTarget({ tabId: tab.id, action: request.action });
  const destructive = isDestructive(target, {
    add: request.policy.add,
    remove: request.policy.remove,
  });
  const gateResult = gate({ level: effectiveLevel, destructive: destructive.matched });

  // ---- 'deny' verdict ----
  if (gateResult.verdict === 'deny') {
    return result(request, 'deny', 'denied', {
      approver: 'user',
      error: `not authorized (level ${effectiveLevel} ${gateResult.reason})`,
      ...(destructive.matched && destructive.term !== undefined
        ? { destructiveTerm: destructive.term }
        : {}),
    });
  }

  // ---- 'allow' verdict (Level-4 non-destructive auto) ----
  if (gateResult.verdict === 'allow') {
    if (request.tool === 'request_authorization') {
      // The AI asked for a token. Level-4 auto returns a usable token
      // without prompting — the next execute_action with this token + the
      // matching (sessionId, actionType) can run.
      const tok = deps.tokens.issue(request.sessionId, request.action.type);
      return result(request, 'allow', 'ok', {
        approver: 'level-4-auto',
        confirmToken: tok.token,
      });
    }
    return dispatchAndRespond(request, tab.id, deps, {
      approver: 'level-4-auto',
    });
  }

  // ---- 'confirm' verdict ----
  // execute_action: if a confirmToken is present + matches, skip the banner.
  if (request.tool === 'execute_action') {
    // The handler signature doesn't carry confirmToken explicitly; the host
    // sends it inside the action.request payload as a sibling field if the
    // wire shape grows. For now: re-route through a banner unless a future
    // patch passes the token alongside the request (see action-protocol.ts
    // TODO). Doing it this way keeps the gate honest in the default path.
  }

  const userVerdict = await deps.promptUserConfirmation({
    request,
    origin,
    target,
    destructive: {
      matched: destructive.matched,
      ...(destructive.term !== undefined ? { term: destructive.term } : {}),
    },
  });

  if (userVerdict.verdict === 'deny') {
    return result(request, 'deny', 'denied', {
      approver: 'user',
      approvalMs: userVerdict.approvalMs,
      error: 'reason' in userVerdict ? `denied (${userVerdict.reason})` : 'user denied',
      ...(destructive.matched && destructive.term !== undefined
        ? { destructiveTerm: destructive.term }
        : {}),
    });
  }

  // User allowed.
  if (request.tool === 'request_authorization') {
    const tok = deps.tokens.issue(request.sessionId, request.action.type);
    return result(request, 'allow', 'ok', {
      approver: 'user',
      approvalMs: userVerdict.approvalMs,
      confirmToken: tok.token,
      ...(destructive.matched && destructive.term !== undefined
        ? { destructiveTerm: destructive.term }
        : {}),
    });
  }
  // execute_action: dispatch.
  return dispatchAndRespond(request, tab.id, deps, {
    approver: 'user',
    approvalMs: userVerdict.approvalMs,
    ...(destructive.matched && destructive.term !== undefined
      ? { destructiveTerm: destructive.term }
      : {}),
  });
}

async function dispatchAndRespond(
  request: ActionRequestMessage,
  tabId: number,
  deps: ActionHandlerDeps,
  meta: {
    approver: ActionResultMessage['approver'];
    approvalMs?: number;
    destructiveTerm?: string;
  },
): Promise<ActionResultMessage> {
  let res: Awaited<ReturnType<ActionHandlerDeps['dispatchInMainWorld']>>;
  try {
    res = await deps.dispatchInMainWorld({ tabId, action: request.action });
  } catch (err) {
    return result(request, 'allow', 'error', {
      ...meta,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (res.ok) {
    return result(request, 'allow', 'ok', {
      ...meta,
      ...(res.details !== undefined ? { details: res.details } : {}),
    });
  }
  return result(request, 'allow', 'error', {
    ...meta,
    error: res.error,
  });
}

function result(
  request: ActionRequestMessage,
  verdict: ActionResultMessage['verdict'],
  resultKind: ActionResultMessage['result'],
  meta: {
    approver: ActionResultMessage['approver'];
    approvalMs?: number;
    error?: string;
    confirmToken?: string;
    details?: unknown;
    destructiveTerm?: string;
  },
): ActionResultMessage {
  const message: ActionResultMessage = {
    type: 'action.result',
    requestId: request.requestId,
    tool: request.tool,
    verdict,
    result: resultKind,
    approver: meta.approver,
  };
  if (meta.approvalMs !== undefined) message.approvalMs = meta.approvalMs;
  if (meta.error !== undefined) message.error = meta.error;
  if (meta.confirmToken !== undefined) message.confirmToken = meta.confirmToken;
  if (meta.details !== undefined) message.details = meta.details;
  if (meta.destructiveTerm !== undefined) message.destructiveTerm = meta.destructiveTerm;
  return message;
}
