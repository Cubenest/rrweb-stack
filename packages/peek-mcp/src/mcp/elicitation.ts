// Peek-driven per-action consent via MCP elicitation (SP3a / Option B). At an act
// dispatch, peek asks the connecting client (the connector) to collect the human's
// Approve/Deny on ITS surface via a server->client elicitInput — cloning roots.ts's
// defensive shape (capability-probe -> race a human-scale timeout -> degrade safely).
// No SDK bump (@modelcontextprotocol/sdk 1.29 ships elicitInput).
//
// peek-mcp does NOT classify "destructive"/"act" — that lives in the SW gate and
// duplicating it drifts (see the connector's classify() liability). The SW gate +
// destructive-override remain the backstop; elicitation is an ADDITIONAL delegated
// prompt for the execute_action tool only.

import type { Action } from './action-schema.js';

/** The subset of `McpServer.server` this module needs (structurally loose so the
 *  SDK's richer types assign under exactOptionalPropertyTypes). */
export interface ElicitCapableServer {
  getClientCapabilities(): { elicitation?: { form?: unknown } | undefined } | undefined;
  elicitInput(
    params: {
      message: string;
      requestedSchema: { type: 'object'; properties: Record<string, never> };
    },
    options?: { timeout?: number },
  ): Promise<{ action: 'accept' | 'decline' | 'cancel' }>;
}

/** `elicited:false` = the client did not advertise elicitation → the caller
 *  proceeds to the normal SW gate (no delegation). */
export type ElicitOutcome =
  | { elicited: false; reason: 'no-capability' }
  | { elicited: true; verdict: 'approve'; reason: 'accepted' }
  | { elicited: true; verdict: 'deny'; reason: 'declined' | 'timeout' | 'error' };

/** Human-scale default, kept BELOW the bridge's 5-min budget so the bridge never
 *  wins the race and a slow human yields a clean decline, not a transport error. */
export const DEFAULT_ELICIT_TIMEOUT_MS = 120_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([
      promise.then((v) => ({ timedOut: false as const, value: v })),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ElicitConsentOptions {
  readonly timeoutMs?: number;
}

/** Ask the connecting client to collect a human Approve/Deny for `message`.
 *  Never throws — every failure mode degrades to a safe verdict. */
export async function elicitConsent(
  server: ElicitCapableServer,
  message: string,
  options: ElicitConsentOptions = {},
): Promise<ElicitOutcome> {
  const caps = server.getClientCapabilities();
  // The SDK server checks `_clientCapabilities?.elicitation?.form` SPECIFICALLY
  // and throws otherwise — so `.form` (not just `.elicitation`) is the real gate.
  if (!caps?.elicitation?.form) {
    return { elicited: false, reason: 'no-capability' };
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_ELICIT_TIMEOUT_MS;
  const raced = await withTimeout(
    server.elicitInput(
      { message, requestedSchema: { type: 'object', properties: {} } },
      { timeout: timeoutMs },
    ),
    timeoutMs,
  ).catch(() => ({ timedOut: false as const, value: undefined }));
  if (raced.timedOut) return { elicited: true, verdict: 'deny', reason: 'timeout' };
  const result = raced.value;
  if (!result || typeof result.action !== 'string') {
    return { elicited: true, verdict: 'deny', reason: 'error' };
  }
  return result.action === 'accept'
    ? { elicited: true, verdict: 'approve', reason: 'accepted' }
    : { elicited: true, verdict: 'deny', reason: 'declined' };
}

/** Mask a sensitive value for a consent card: keep the first and last visible
 *  character, replace the middle with a fixed 3-char bullet run (never
 *  length-proportional — length must not leak). Values of length ≤ 2 mask
 *  wholly, so a 1- or 2-char secret is never shown. */
export function maskValue(value: string): string {
  if (value.length <= 2) return '•••';
  const first = value[0];
  const last = value[value.length - 1];
  // Both indices are defined: length > 2 guarantees [0] and [length-1] exist.
  return `${first ?? ''}•••${last ?? ''}`;
}

/**
 * Human-facing egress consent-card text for a session bundle export. Distinct
 * from {@link buildElicitMessage} (which is for live-browser actions): this
 * describes a *data-egress* event — the bundle leaving the local-first store.
 *
 * @param sessionId  The session being exported (e.g. `s_acme-orders-0001`).
 * @param surface    Where the bundle will go (e.g. `Slack`, `Discord`).
 */
export function buildEgressConsentMessage(sessionId: string, surface: string): string {
  // Sanitize sessionId for display: strip control characters (incl. newlines) so
  // a crafted id cannot inject into the consent card text.
  const safeSessionId = sessionId.replace(/[^\x20-\x7E]/g, '_');
  // Sanitize surface the same way: it is caller-supplied and interpolated into
  // the consent card, so a crafted value could inject newlines/control chars to
  // spoof the approval prompt.
  const safeSurface = surface.replace(/[^\x20-\x7E]/g, '_').slice(0, 60);
  return (
    `peek wants to upload this session's bundle (${safeSessionId} — recorded DOM + ` +
    `console/network, masked) to ${safeSurface}. This data leaves your local-first peek store. Approve?`
  );
}

/** Human-facing consent-card text for an action. peek-mcp does NOT classify the
 *  action as destructive/act (that lives in the SW gate) — it only describes it,
 *  masking any literal value that would otherwise persist in the client's chat
 *  history. Widening the parameter to the Action union is peek-mcp-internal: the
 *  caller (server.ts dispatchActTool) already passes the full typed input.action,
 *  so the MCP contract is unchanged. */
export function buildElicitMessage(action: Action): string {
  const tail = 'on your live browser. Approve?';
  const target = (ref?: string, selector?: string, nth?: number): string => {
    const base = ref ?? selector ?? '(active element)';
    return nth !== undefined ? `\`${base}\` #${nth}` : `\`${base}\``;
  };
  switch (action.type) {
    case 'click':
      return `peek wants to Click ${target(action.ref, action.selector, action.nth)} ${tail}`;
    case 'dblclick':
      return `peek wants to Double-click ${target(action.ref, action.selector, action.nth)} ${tail}`;
    case 'type':
      return `peek wants to Type "${maskValue(action.text)}" into ${target(action.ref, action.selector)} ${tail}`;
    case 'enter':
      return `peek wants to press Enter on ${target(action.ref, action.selector)} ${tail}`;
    case 'navigate':
      return `peek wants to Navigate to ${action.url} ${tail}`;
    case 'back':
      return `peek wants to go back ${tail}`;
    case 'forward':
      return `peek wants to go forward ${tail}`;
    case 'reload':
      return `peek wants to Reload the page ${tail}`;
    case 'scroll':
      return action.ref !== undefined || action.selector !== undefined
        ? `peek wants to Scroll ${target(action.ref, action.selector)} into view ${tail}`
        : `peek wants to Scroll the page ${tail}`;
    case 'screenshot':
      return `peek wants to take a screenshot ${tail}`;
    case 'waitFor':
      return action.selector !== undefined
        ? `peek wants to wait for ${target(undefined, action.selector)} ${tail}`
        : `peek wants to wait ${tail}`;
    case 'highlight':
      return `peek wants to Highlight ${target(undefined, action.selector)} ${tail}`;
    case 'clear_highlight':
      return `peek wants to clear the highlight ${tail}`;
    case 'set_intent':
      return `peek wants to set its intent banner ${tail}`;
    case 'request_user_input':
      return `peek wants to ask you: "${maskValue(action.prompt)}" ${tail}`;
    default:
      // Unmodeled/read verbs (page_view, element_detail) or a future type —
      // name it generically. `action` narrows to the remaining union members.
      return `peek wants to run "${action.type}" ${tail}`;
  }
}
