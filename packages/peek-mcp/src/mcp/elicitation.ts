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

/** Human-facing card text for an action. peek-mcp does not classify the action —
 *  it just names it. */
export function buildElicitMessage(action: { type: string }): string {
  return `peek wants to run "${action.type}" on your live browser. Approve?`;
}
