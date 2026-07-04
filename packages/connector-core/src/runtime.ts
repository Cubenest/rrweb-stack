import type { Brain } from './brain.js';
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
  constructor(private readonly deps: RuntimeDeps) {}

  async start(): Promise<void> {
    const { adapter } = this.deps;
    adapter.onMessage((m) => {
      this.handleMessage(m).catch((err) => console.error('connector handleMessage error:', err));
    });
    adapter.onConsentResponse((r) => {
      this.handleConsentResponse(r).catch((err) =>
        console.error('connector handleConsentResponse error:', err),
      );
    });
    await adapter.start();
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
      const outcome = await brain.runTurn(stored.session);
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
