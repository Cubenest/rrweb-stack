import type { AgentOutcome, Brain } from './brain.js';
import type { PeekMcp } from './mcp.js';
import type { SessionStore } from './store.js';
import type { ConsentResponse, InboundMessage, SurfaceAdapter } from './surface.js';

const ERROR_TEXT = '⚠️ Something went wrong reaching peek. Please try again.';
const DENY_RESULT =
  'The user denied this action. Do not retry it; explain or suggest an alternative.';

let correlationCounter = 0;
function mintCorrelationId(): string {
  correlationCounter += 1;
  return `pc-${Date.now()}-${correlationCounter}`;
}

export interface RuntimeDeps {
  adapter: SurfaceAdapter;
  brain: Brain;
  mcp: PeekMcp;
  store: SessionStore;
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

  async start(): Promise<void> {
    const { adapter, mcp } = this.deps;
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
      await adapter.postText(conversationId, ERROR_TEXT);
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
      brain.appendToolResult(stored.session, pending.toolUseId, text, isError);
      await adapter.postConfirmation(r.conversationId, 'Approved — acting…');
    } else {
      brain.appendToolResult(stored.session, pending.toolUseId, DENY_RESULT, true);
      await adapter.postConfirmation(r.conversationId, 'Denied.');
    }
    await this.runLoop(r.conversationId);
  }
}
