import { describe, expect, it, vi } from 'vitest';
import type { Brain, Session } from './brain.js';
import { ConnectorRuntime } from './runtime.js';
import { SessionStore } from './store.js';
import type { ConsentResponse, InboundMessage, SurfaceAdapter } from './surface.js';

class FakeAdapter implements SurfaceAdapter {
  msgHandler?: (m: InboundMessage) => void;
  consentHandler?: (r: ConsentResponse) => void;
  texts: Array<[string, string]> = [];
  consents: Array<[string, { correlationId: string }]> = [];
  confirmations: Array<[string, string]> = [];
  async start() {}
  async stop() {}
  onMessage(h: (m: InboundMessage) => void) {
    this.msgHandler = h;
  }
  onConsentResponse(h: (r: ConsentResponse) => void) {
    this.consentHandler = h;
  }
  async postText(c: string, t: string) {
    this.texts.push([c, t]);
  }
  async postConsentRequest(c: string, req: { correlationId: string }) {
    this.consents.push([c, req]);
  }
  async postConfirmation(c: string, t: string) {
    this.confirmations.push([c, t]);
  }
}

// Scripted brain: first turn suspends on an action; after the tool result is appended, next turn is done.
function scriptedBrain(): Brain {
  let toolResultSeen = false;
  return {
    newSession: (): Session => ({ history: [] }),
    appendUserText: () => {},
    appendToolResult: () => {
      toolResultSeen = true;
    },
    runTurn: async () =>
      toolResultSeen
        ? { kind: 'done', text: 'acted' }
        : {
            kind: 'consent',
            action: { toolUseId: 'u1', toolName: 'execute_action', input: { x: 1 }, createdAt: 0 },
          },
  };
}

describe('ConnectorRuntime consent flow', () => {
  it('does not execute the tool until approval, then executes and continues', async () => {
    const callTool = vi.fn().mockResolvedValue('ok');
    const adapter = new FakeAdapter();
    const brain = scriptedBrain();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool } as unknown as import('./mcp.js').PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'fix it' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));
    expect(callTool).not.toHaveBeenCalled(); // gate: no execution before approval

    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';
    adapter.consentHandler?.({ conversationId: 't1', correlationId, decision: 'approve' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['t1', 'acted']));
    expect(callTool).toHaveBeenCalledWith('execute_action', { x: 1 });
    expect(adapter.confirmations).toContainEqual(['t1', 'Approved — acting…']);
  });

  it('ignores a consent response whose correlationId does not match pending', async () => {
    const callTool = vi.fn().mockResolvedValue('ok');
    const adapter = new FakeAdapter();
    const brain = scriptedBrain();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool } as unknown as import('./mcp.js').PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'fix it' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));
    adapter.consentHandler?.({ conversationId: 't1', correlationId: 'WRONG', decision: 'approve' });
    await new Promise((r) => setTimeout(r, 20));
    expect(callTool).not.toHaveBeenCalled();
  });
});
