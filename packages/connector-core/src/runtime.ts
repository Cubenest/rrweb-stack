import { rm } from 'node:fs/promises';
import type { AgentOutcome, Brain } from './brain.js';
import type { PeekMcp } from './mcp.js';
import type { SecretStore } from './secret-store.js';
import type { SessionStore } from './store.js';
import type { ConsentResponse, InboundMessage, SurfaceAdapter } from './surface.js';

const DENY_RESULT =
  'The user denied this action. Do not retry it; explain or suggest an alternative.';

let correlationCounter = 0;
function mintCorrelationId(): string {
  correlationCounter += 1;
  return `pc-${Date.now()}-${correlationCounter}`;
}

/** Defensively classify a caught turn error into a small, legible set. The default
 *  {kind:'unknown'} branch ensures a provider swap (whose error strings differ)
 *  can never break error handling — classification is provider-coupled, so it is
 *  best-effort and always falls through to a safe generic. Hints are SUGGESTIVE,
 *  not authoritative.
 *
 *  Substring grounding (verified against mcp.ts + sdk-brain.ts + @anthropic-ai/sdk):
 *  - 'mcp connect' → withTimeout label 'mcp connect' → "mcp connect timed out after Nms"
 *  - 'mcp calltool' → withTimeout label `mcp callTool(${name})` → "mcp callTool(X) timed out after Nms"
 *    (checked BEFORE generic timeout branches so a callTool-timeout → tool-error, not consent-timeout)
 *  - '401' → AuthenticationError.makeMessage → "401 {error message from API}"
 *  - 'connection error' → APIConnectionError → "Connection error." (case-insensitive)
 *  - 'tool-use turns' → SdkBrain → "SdkBrain exceeded N tool-use turns"
 *    (brief used 'maxturns'/'max turns' which do NOT appear in the real message — fixed)
 *  - 'timeout' + ('elicit'|'consent') → peek-mcp elicitation deny/timeout text */
export function classifyError(err: unknown): { kind: string; headline: string; hint: string } {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const m = msg.toLowerCase();
  if (m.includes('mcp connect')) {
    return {
      kind: 'mcp-connection-lost',
      headline: 'Lost the connection to peek',
      hint: 'The peek daemon may have stopped. Check that it is running, then try again.',
    };
  }
  if (m.includes('mcp calltool')) {
    return {
      kind: 'tool-error',
      headline: 'A peek tool call failed',
      hint: 'The action or query did not complete. Try rephrasing or ask again.',
    };
  }
  if (
    m.includes('401') ||
    m.includes('unauthorized') ||
    m.includes('x-api-key') ||
    m.includes('invalid api key')
  ) {
    return {
      kind: 'llm-key-rejected',
      headline: 'The AI provider rejected the API key',
      hint: 'Check the model API key configured for the connector.',
    };
  }
  if (
    m.includes('econnrefused') ||
    m.includes('connection error') ||
    m.includes('fetch failed') ||
    m.includes('enotfound')
  ) {
    return {
      kind: 'llm-endpoint-error',
      headline: "Couldn't reach the AI provider",
      hint: 'The model endpoint may be down or the base URL misconfigured. Try again shortly.',
    };
  }
  if (m.includes('no recording') || m.includes('not recording') || m.includes('no session')) {
    return {
      kind: 'not-recording',
      headline: 'No recorded session to work with',
      hint: 'Open the peek extension and record a browser session first.',
    };
  }
  if (m.includes('timeout') && (m.includes('elicit') || m.includes('consent'))) {
    return {
      kind: 'consent-timeout',
      headline: 'The approval request timed out',
      hint: 'No Approve/Deny was received in time. Send your request again.',
    };
  }
  if (m.includes('tool-use turns')) {
    return {
      kind: 'max-turns',
      headline: 'The turn ran out of steps',
      hint: 'peek reached its per-turn step limit. Narrow the request and try again.',
    };
  }
  return {
    kind: 'unknown',
    headline: 'Something went wrong reaching peek',
    hint: 'Please try again. If it keeps happening, check the connector logs.',
  };
}

export interface RuntimeDeps {
  adapter: SurfaceAdapter;
  brain: Brain;
  mcp: PeekMcp;
  store: SessionStore;
  /** Optional; when present, pairing + secret-on-start are enabled. */
  secretStore?: SecretStore;
}

export class ConnectorRuntime {
  #activeConversationId: string | undefined;
  #pendingElicit:
    | { correlationId: string; conversationId: string; resolve: (d: 'approve' | 'deny') => void }
    | undefined;
  // Serialize turn processing: each new inbound message's body is chained so
  // turns run strictly one at a time. handleConsentResponse is NOT routed
  // through this chain — consent responses must remain able to resolve a
  // #pendingElicit while a turn is parked awaiting consent inside the chain.
  #turnChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RuntimeDeps) {}

  /**
   * Wrap a low-level `callTool` (typically `mcp.callTool`) so an approved
   * `share_session` result is post-processed on the REAL path the brain
   * actually takes.
   *
   * `share_session` is classified `'read'` by `classify()`, so `SdkBrain.runTurn`
   * runs it INLINE via its injected `callTool` and feeds the result straight back
   * into the tool-use loop — it never emits a `{kind:'consent'}` outcome and so
   * never flows through `handleConsentResponse`. The bundle upload + temp-file
   * cleanup therefore has to happen at THIS boundary (the callTool the brain
   * consumes), not in the consent handler.
   *
   * The interception needs the surface adapter (`postFile`), which `PeekMcp`
   * does not hold — the runtime does. So the runtime owns the wrapper and the
   * composition root hands the brain `runtime.interceptCallTool(name, input, inner)`
   * instead of the bare `mcp.callTool`. This keeps `PeekMcp` a pure transport and
   * preserves the brain/runtime separation (the brain still only sees a plain
   * `(name, input) => Promise<string>`).
   *
   * The `conversationId` for the upload is read from `#activeConversationId`,
   * which is set for the duration of the turn in `runLoop`.
   */
  async interceptCallTool(
    name: string,
    input: unknown,
    inner: (name: string, input: unknown) => Promise<string>,
  ): Promise<string> {
    const text = await inner(name, input);
    if (name !== 'share_session') return text;
    return this.#postProcessShareSession(this.#activeConversationId, text);
  }

  /**
   * Given a `share_session` tool-result string, upload the temp bundle via the
   * surface adapter and delete it. Returns the (possibly rewritten) text to feed
   * back to the brain.
   *
   * - `{ok:true, bundlePath, filename}` → `adapter.postFile(...)` inside `try`,
   *   temp bundle deleted in `finally` (success AND failure).
   * - `{ok:false}` (or unparseable / missing fields) → returned unchanged; no
   *   upload, no throw, no delete (there is no temp file to remove).
   * - adapter without `postFile` → degrade to a text note (referencing the
   *   `filename` only, never the raw OS temp path) and still delete the file.
   * - upload error → surfaced to the brain as an error note; the turn continues.
   */
  async #postProcessShareSession(
    conversationId: string | undefined,
    text: string,
  ): Promise<string> {
    const { adapter } = this.deps;
    let parsed: { ok: boolean; bundlePath?: string; filename?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { ok: boolean; bundlePath?: string; filename?: string };
    } catch {
      return text; // not valid JSON — leave as-is
    }
    if (!parsed?.ok || !parsed.bundlePath || !parsed.filename) return text;
    const { bundlePath, filename } = parsed;
    try {
      if (adapter.postFile && conversationId) {
        await adapter.postFile(conversationId, bundlePath, filename, 'peek session bundle');
        return `Session bundle "${filename}" shared successfully.`;
      }
      // No file-upload support (or no active conversation to post into): reference
      // the filename only — never leak the raw OS temp path back to the model/user.
      return `Session bundle "${filename}" is ready, but this surface cannot upload files, so it was not shared.`;
    } catch (uploadErr) {
      // Upload failed: surface a descriptive error to the brain so the
      // conversation can continue. The finally block still deletes the file.
      return `Session bundle export failed during upload: ${String(uploadErr)}`;
    } finally {
      await rm(bundlePath, { force: true });
    }
  }

  async start(): Promise<void> {
    const { adapter, mcp, secretStore } = this.deps;
    // Load any previously-persisted pairing secret and arm it so every
    // execute_action call includes the connectorSecret header from the start.
    if (secretStore) {
      const s = await secretStore.get(mcp.clientName, 'pairing');
      if (s) {
        mcp.setConnectorSecret(s);
      }
    }
    adapter.onMessage((m) => {
      // Serialize turn processing: append each new message's body onto the
      // chain so turns run strictly one at a time. Errors are swallowed so
      // one failed turn doesn't poison the chain and block all future turns.
      this.#turnChain = this.#turnChain
        .then(() => this.handleMessage(m))
        .catch((err) => console.error('connector handleMessage error:', err));
    });
    adapter.onConsentResponse((r) => {
      // Consent responses are NOT serialized through #turnChain — they must
      // remain able to resolve a #pendingElicit while a turn is parked inside
      // the chain awaiting that consent. Serializing them would deadlock.
      this.handleConsentResponse(r).catch((err) =>
        console.error('connector handleConsentResponse error:', err),
      );
    });
    mcp.onElicit((message) => this.handleElicit(message));
    await adapter.start();
  }

  /**
   * Orchestrate the pairing handshake with peek-mcp.
   *
   * Generates a random 4-digit numeric code, surfaces it to the user via
   * `displayCode`, then calls `mcp.requestPairing(code)`. On approval the
   * returned secret is persisted via the injected `SecretStore` (OS keychain by
   * default, `0600` file fallback) and armed on the MCP client so subsequent
   * execute_action calls are banner-less.
   *
   * Note on clientName/connectorId consistency: peek-mcp derives the connector
   * id from the MCP client name (the `clientName` arg to `new PeekMcp(…)`
   * e.g. `'peek-slack'`). The secret is stored under `mcp.clientName` here and
   * retrieved under the same key in `start()`, and peek-mcp's SW-side
   * verification keys on that same client name — so always construct `PeekMcp`
   * with the same client name you pair with.
   */
  async pair(displayCode: (code: string) => void | Promise<void>): Promise<boolean> {
    const { mcp, secretStore } = this.deps;
    if (!secretStore) throw new Error('pair() requires secretStore in RuntimeDeps');

    // Generate a cryptographically random 4-digit code (0000-9999).
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    const code = String((buf[0] as number) % 10000).padStart(4, '0');

    await displayCode(code);
    const response = await mcp.requestPairing(code);

    if (!response.approved || !response.secret) {
      return false;
    }

    await secretStore.set(mcp.clientName, 'pairing', response.secret);
    mcp.setConnectorSecret(response.secret);
    return true;
  }

  private async handleElicit(message: string): Promise<'accept' | 'decline' | 'cancel'> {
    const conversationId = this.#activeConversationId;
    if (!conversationId) return 'cancel'; // no active turn to attribute this to
    if (this.#pendingElicit) return 'cancel'; // serialization guard: ≤1 in-flight elicitation
    const correlationId = mintCorrelationId();
    const decision = await new Promise<'approve' | 'deny'>((resolve) => {
      this.#pendingElicit = { correlationId, conversationId, resolve };
      this.deps.adapter
        .postConsentRequest(conversationId, { correlationId, summary: message, details: {} })
        .catch(() => {
          this.#pendingElicit = undefined;
          resolve('deny');
        });
    });
    return decision === 'approve' ? 'accept' : 'decline';
  }

  private async handleMessage(m: InboundMessage): Promise<void> {
    const { store, brain } = this.deps;
    const stored = store.get(m.conversationId);
    brain.appendUserText(stored.session, m.text);
    await this.runLoop(m.conversationId);
  }

  private async runLoop(conversationId: string): Promise<void> {
    const { store, brain, adapter } = this.deps;
    try {
      const stored = store.get(conversationId);
      this.#activeConversationId = conversationId;
      let outcome: AgentOutcome;
      try {
        outcome = await brain.runTurn(stored.session);
      } finally {
        this.#activeConversationId = undefined;
        // If the turn ended (normally or via exception) while a delegated elicit
        // was still awaiting a human answer, resolve it with 'decline' and free
        // the slot. This prevents the wedge where #pendingElicit stays set for
        // the process lifetime and all future elicitations hit the serialization
        // guard and return 'cancel'.
        const pe = this.#pendingElicit;
        if (pe?.conversationId === conversationId) {
          this.#pendingElicit = undefined;
          pe.resolve('deny');
        }
      }
      if (outcome.kind === 'consent') {
        const correlationId = mintCorrelationId();
        store.setPending(conversationId, { ...outcome.action, correlationId });
        await adapter.postConsentRequest(conversationId, {
          correlationId,
          summary: 'peek wants to act on your live browser',
          details: outcome.action.input,
        });
      } else {
        await adapter.postText(conversationId, outcome.text);
      }
    } catch (err) {
      console.error('connector loop error:', err);
      const classified = classifyError(err);
      if (adapter.postError) {
        await adapter.postError(conversationId, classified);
      } else {
        await adapter.postText(conversationId, `${classified.headline}. ${classified.hint}`);
      }
    }
  }

  private async handleConsentResponse(r: ConsentResponse): Promise<void> {
    const { store, brain, mcp, adapter } = this.deps;

    // SP3a elicitation path: if a pending elicit matches, resolve it and return.
    // This runs before the SP2 suspend-path so delegated-consent responses are
    // handled inline without touching the pending-store.
    const pe = this.#pendingElicit;
    if (pe && pe.correlationId === r.correlationId && pe.conversationId === r.conversationId) {
      this.#pendingElicit = undefined;
      pe.resolve(r.decision);
      return; // elicitation path — the brain's inline callTool proceeds on this verdict
    }

    const stored = store.get(r.conversationId);
    const pending = stored.pending;
    if (!pending || pending.correlationId !== r.correlationId) return;
    store.clearPending(r.conversationId); // before await → idempotent vs double-click

    if (r.decision === 'approve') {
      let text: string;
      let isError = false;
      try {
        text = await mcp.callTool(pending.toolName, pending.input);
      } catch (err) {
        text = `Tool call failed: ${String(err)}`;
        isError = true;
      }

      // NOTE: share_session is NOT intercepted here. It is classified 'read' by
      // classify(), so SdkBrain runs it inline via its injected callTool and it
      // never becomes a {kind:'consent'} outcome — so it never reaches this
      // consent handler on the real path. The upload + temp-file cleanup lives at
      // the callTool boundary in interceptCallTool()/#postProcessShareSession().

      brain.appendToolResult(stored.session, pending.toolUseId, text, isError);
      await adapter.postConfirmation(r.conversationId, 'Approved — acting…');
    } else {
      brain.appendToolResult(stored.session, pending.toolUseId, DENY_RESULT, true);
      await adapter.postConfirmation(r.conversationId, 'Denied.');
    }
    await this.runLoop(r.conversationId);
  }
}
