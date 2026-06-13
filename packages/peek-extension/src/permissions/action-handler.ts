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

/**
 * A fast, stable, non-cryptographic string hash (FNV-1a, 32-bit, hex). Used to
 * bind the typed text of a `type` action into its fingerprint WITHOUT putting
 * the plaintext (which may be a password) into the token record or any log.
 * Collision resistance is not a security property we depend on here — the token
 * is one-shot, short-lived (2 min), and the user already saw + approved the
 * action; the hash exists so a token approved for one text can't be reused for
 * a DIFFERENT text. Self-contained (no node:crypto) so it works in the SW.
 */
function hashText(text: string): string {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // FNV prime multiply via shifts; `>>> 0` keeps it an unsigned 32-bit int.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A stable, security-bearing fingerprint of the EXACT action the user was shown
 * in the confirm banner. A confirm token is bound to this string; an
 * `execute_action` whose action produces a different fingerprint cannot spend
 * the token.
 *
 * The fingerprint covers everything that changes WHAT the action does to the
 * page — type + selector + nth (click), type + selector + a HASH of the typed
 * text (type; see below), url (navigate), selector/x/y (scroll). Client-chosen
 * `sessionId` is deliberately NOT part of the fingerprint: it is not a security
 * boundary (the client picks it).
 *
 * Note: this binds the AI's INTENT (the action it asked the user to approve).
 * The destructive-DOM-state check is enforced separately at consume time
 * (re-running the matcher against the freshly-resolved target), so a token
 * cannot bypass the destructive override even if its fingerprint matches.
 */
export function actionFingerprint(action: Action): string {
  switch (action.type) {
    case 'click':
      // `button` is intentionally omitted: the MAIN-world dispatcher always
      // performs a plain left-click (`el.click()`) and ignores `action.button`,
      // so it never changes WHAT the action does. IF `button` is ever wired to
      // a real MouseEvent (e.g. a right-click context-menu action), it MUST be
      // added here — otherwise a left-click token could be spent on a
      // right-click of the same selector.
      return `click|${action.selector}|nth=${action.nth ?? '*'}`;
    case 'type':
      // Item B: bind a HASH of the typed text so a token approved for
      // `type #amount "100"` can't be spent on `type #amount "999999"`. We hash
      // (not plaintext) because the text may be a secret — it's never shown in
      // the banner and must not land in the token record. `delay` stays
      // excluded (cosmetic; doesn't change WHAT is typed).
      return `type|${action.selector}|text=${hashText(action.text)}`;
    case 'navigate':
      return `navigate|${action.url}`;
    case 'scroll':
      return `scroll|sel=${action.selector ?? ''}|x=${action.x ?? ''}|y=${action.y ?? ''}`;
    case 'screenshot':
      return `screenshot|sel=${action.selector ?? ''}`;
    case 'waitFor':
      return `waitFor|sel=${action.selector ?? ''}|t=${action.timeoutMs}`;
    default:
      // back / forward / reload — no parameters beyond the type.
      return action.type;
  }
}

/** A confirm-token issuance: one-shot, bound to an exact action fingerprint. */
export interface ConfirmToken {
  /** Opaque token string (UUID). */
  token: string;
  /**
   * The exact action fingerprint this token authorizes (see
   * {@link actionFingerprint}). The ONLY binding the consume path trusts.
   */
  fingerprint: string;
  /** ms-since-epoch when the token was issued. */
  issuedAtMs: number;
  /** ms-since-epoch when the token expires (issuedAt + ttlMs). */
  expiresAtMs: number;
}

/** TTL for an unused confirm token. 2 minutes — same as the brief's default-deny window. */
export const CONFIRM_TOKEN_TTL_MS = 2 * 60_000;

export interface ConfirmTokenStore {
  /** Issue a fresh token bound to `action`'s exact fingerprint + an expiry tick. */
  issue(action: Action): ConfirmToken;
  /**
   * Consume a token. Returns the token record only if the token is valid,
   * unexpired, and `action`'s fingerprint EXACTLY matches the issued one;
   * returns null otherwise (unknown, already-used, expired, fingerprint
   * mismatch). One-shot: the token is removed even on a failed match, so a
   * malicious caller can't retry with the right args.
   */
  consume(token: string, action: Action, nowMs?: number): ConfirmToken | null;
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

  issue(action: Action): ConfirmToken {
    const token = this.#deps.generateToken();
    const now = this.#deps.now();
    const record: ConfirmToken = {
      token,
      fingerprint: actionFingerprint(action),
      issuedAtMs: now,
      expiresAtMs: now + CONFIRM_TOKEN_TTL_MS,
    };
    this.#tokens.set(token, record);
    return record;
  }

  consume(token: string, action: Action, nowMs?: number): ConfirmToken | null {
    const record = this.#tokens.get(token);
    if (!record) return null;
    // One-shot: remove regardless of whether the rest of the check passes,
    // so a malicious AI can't re-use a token by retrying with the right args.
    this.#tokens.delete(token);
    const now = nowMs ?? this.#deps.now();
    if (now > record.expiresAtMs) return null;
    // The ONLY trusted binding: the exact action fingerprint shown in the banner.
    if (record.fingerprint !== actionFingerprint(action)) return null;
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
  /**
   * Re-fetch a tab by its EXACT id (item A). The dispatch-time TOCTOU
   * re-validation uses this — never `getTabFor` — so it inspects the SAME tab
   * the gate resolved, not whatever happens to be active now (which could be a
   * different tab that still passes the origin/level checks while the captured
   * tab navigated cross-origin). Returns undefined if the tab is gone.
   */
  getTabById(tabId: number): Promise<TabRef | undefined>;
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
    // Item F: a deny carries WHY — a no-response timeout, an explicit user Deny,
    // or a panel close — so the audit log records the real cause.
    | { verdict: 'deny'; approvalMs: number; reason: 'timeout' | 'user-deny' | 'panel-closed' }
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

  // Capture the gated context so the dispatch-time re-validation (item A,
  // TOCTOU) can assert the tab/origin/level are STILL the ones the gate decided
  // on — the tab may navigate elsewhere during the up-to-2-min confirm wait.
  const guarded = { origin, effectiveLevel };

  // ---- Highlight overlays (Level-2 "Suggest" tier) ----------------------
  // Highlights are NON-mutating: a ring drawn over an element, never a click/
  // type/navigate. They route around the execute_action gate entirely (see
  // gate.ts Level-2 note): no destructive matcher, no confirm banner, no token,
  // no TOCTOU re-validation (there is no confirm-wait to create a TOCTOU
  // window). Auto-allowed at effective Level >= 2; denied below.
  if (request.action.type === 'highlight' || request.action.type === 'clear_highlight') {
    if (effectiveLevel < 2) {
      return result(request, 'deny', 'denied', {
        approver: 'user',
        error: `level-too-low-for-highlight (level ${effectiveLevel})`,
      });
    }
    let highlightRes: Awaited<ReturnType<ActionHandlerDeps['dispatchInMainWorld']>>;
    try {
      highlightRes = await deps.dispatchInMainWorld({ tabId: tab.id, action: request.action });
    } catch (err) {
      return result(request, 'allow', 'error', {
        approver: 'level-2-suggest',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (highlightRes.ok) {
      return result(request, 'allow', 'ok', {
        approver: 'level-2-suggest',
        ...(highlightRes.details !== undefined ? { details: highlightRes.details } : {}),
      });
    }
    return result(request, 'allow', 'error', {
      approver: 'level-2-suggest',
      error: highlightRes.error,
    });
  }

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
      // matching action fingerprint can run.
      const tok = deps.tokens.issue(request.action);
      return result(request, 'allow', 'ok', {
        approver: 'level-4-auto',
        confirmToken: tok.token,
      });
    }
    return dispatchAndRespond(request, tab.id, deps, guarded, {
      approver: 'level-4-auto',
    });
  }

  // ---- 'confirm' verdict ----
  // execute_action: if a confirmToken is present + valid, consume it and skip
  // the banner. The token is one-shot + bound to the EXACT action fingerprint
  // shown in the prior banner, so a token approved for `click #newsletter-ok`
  // can't be spent on `click #delete-account` (the store's consume() deletes
  // the token regardless of whether the match passes). A mismatched / expired /
  // unknown token returns null → fall through to the banner.
  //
  // SECURITY: even a fingerprint-matching token must NOT bypass the destructive
  // override. We re-run the destructive matcher against the FRESHLY resolved
  // target; if it now fires, we force a fresh confirm banner instead of
  // auto-dispatching (the destructive state may have appeared since the token
  // was issued, or the token was issued for a non-destructive variant).
  // request_authorization always prompts (it exists to ISSUE tokens).
  if (request.tool === 'execute_action' && request.confirmToken !== undefined) {
    const consumed = deps.tokens.consume(request.confirmToken, request.action);
    if (consumed !== null && !destructive.matched) {
      return dispatchAndRespond(request, tab.id, deps, guarded, {
        approver: 'user',
      });
    }
    // consumed!==null but destructive → fall through to the banner (a one-shot
    // token was spent, but the destructive override beats it; the user must
    // confirm the destructive action they're actually about to run).
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
    const tok = deps.tokens.issue(request.action);
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
  return dispatchAndRespond(request, tab.id, deps, guarded, {
    approver: 'user',
    approvalMs: userVerdict.approvalMs,
    ...(destructive.matched && destructive.term !== undefined
      ? { destructiveTerm: destructive.term }
      : {}),
  });
}

/**
 * The lowest per-origin level at which `execute_action` is authorized: Level 3
 * (act-with-confirm) and Level 4 (YOLO) authorize; Levels 0–2 deny. The
 * dispatch-time re-check (item A) asserts the CURRENT level still meets this.
 */
const MIN_ACT_LEVEL = 3;

/**
 * Re-validate the gated context immediately before injecting (item A, TOCTOU).
 * Returns `{ ok: true }` only if, RIGHT NOW: the CAPTURED tab still resolves,
 * its current origin equals the origin that was gated/confirmed, that origin is
 * still enabled, and its current effective level is still ≥ {@link MIN_ACT_LEVEL}.
 * Any deviation → `{ ok: false, error }` and the caller must NOT dispatch.
 *
 * Item A — we re-fetch the EXACT tab id resolved at gate time (`capturedTabId`)
 * via {@link ActionHandlerDeps.getTabById}, NOT `getTabFor` again. Calling
 * `getTabFor` could re-resolve a DIFFERENT active tab than the one whose id is
 * about to be passed to `dispatchInMainWorld`: an attacker navigates the
 * captured tab cross-origin while a sibling tab stays on the original origin, so
 * a re-resolution of the active tab would pass the guard yet the dispatch hits
 * the navigated tab. Re-fetching the captured id closes that hole.
 */
async function revalidateAtDispatch(
  capturedTabId: number,
  deps: ActionHandlerDeps,
  guarded: { origin: string; effectiveLevel: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tab = await deps.getTabById(capturedTabId);
  if (!tab || tab.id === undefined) {
    return { ok: false, error: 'dispatch aborted: target tab disappeared during confirm' };
  }
  const originResolver = deps.originForTab ?? defaultOriginForTab;
  const currentOrigin = originResolver(tab);
  if (!currentOrigin) {
    return { ok: false, error: 'dispatch aborted: target tab has no http(s) origin now' };
  }
  if (currentOrigin !== guarded.origin) {
    // The classic TOCTOU: banner showed origin A, tab navigated to origin B.
    return {
      ok: false,
      error: `dispatch aborted: origin changed during confirm (${guarded.origin} → ${currentOrigin})`,
    };
  }
  const stillEnabled = await isOriginEnabled(tab.url ?? currentOrigin);
  if (!stillEnabled) {
    return { ok: false, error: `dispatch aborted: origin no longer enabled (${currentOrigin})` };
  }
  const persistentLevel = await getPermissionLevel(currentOrigin);
  const yoloActive = deps.yolo.isActive(currentOrigin);
  const currentLevel = yoloActive ? 4 : persistentLevel;
  if (currentLevel < MIN_ACT_LEVEL) {
    return {
      ok: false,
      error: `dispatch aborted: permission level dropped during confirm (now ${currentLevel})`,
    };
  }
  return { ok: true };
}

async function dispatchAndRespond(
  request: ActionRequestMessage,
  tabId: number,
  deps: ActionHandlerDeps,
  guarded: { origin: string; effectiveLevel: number },
  meta: {
    approver: ActionResultMessage['approver'];
    approvalMs?: number;
    destructiveTerm?: string;
  },
): Promise<ActionResultMessage> {
  // ---- Item A: TOCTOU re-validation -------------------------------------
  // The tab/origin/level were captured BEFORE the (up-to-2-min) confirm wait.
  // Re-fetch the CAPTURED tab (by its exact id — `tabId`) NOW and assert
  // nothing relevant changed, so a navigation to a different origin during the
  // wait can't redirect the dispatch into a site the user never saw in the
  // banner. We pass the captured `tabId` (not the request) so the re-check
  // inspects the same tab the dispatch will hit, never a re-resolved active
  // tab. Any failure → deny, do NOT dispatch.
  const revalidation = await revalidateAtDispatch(tabId, deps, guarded);
  if (!revalidation.ok) {
    return result(request, 'deny', 'error', {
      ...meta,
      error: revalidation.error,
    });
  }

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
