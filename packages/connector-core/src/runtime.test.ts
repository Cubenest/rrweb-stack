import { describe, expect, it, vi } from 'vitest';
import type { AgentOutcome, Brain, Session } from './brain.js';
import type { PeekMcp } from './mcp.js';
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
    const mcp = { callTool, onElicit: () => {} } as unknown as import('./mcp.js').PeekMcp;
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
    const mcp = { callTool, onElicit: () => {} } as unknown as import('./mcp.js').PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'fix it' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));
    adapter.consentHandler?.({ conversationId: 't1', correlationId: 'WRONG', decision: 'approve' });
    await new Promise((r) => setTimeout(r, 20));
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe('ConnectorRuntime elicit handler (SP3a delegated consent)', () => {
  class FakeMcpWithElicit {
    callTool = vi.fn().mockResolvedValue('ok');
    elicitCb?: (message: string) => Promise<'accept' | 'decline' | 'cancel'>;
    onElicit(cb: (message: string) => Promise<'accept' | 'decline' | 'cancel'>) {
      this.elicitCb = cb;
    }
  }

  // Brain that always returns a consent outcome — simulates delegateActionConsent=false
  // but we test the elicit path directly by invoking the registered handler.
  function idleBrain(): Brain {
    return {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => new Promise(() => {}), // never resolves — keeps turn active
    };
  }

  // Brain that returns a done outcome once a turn is awaited
  function doneBrain(): Brain {
    return {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => ({ kind: 'done' as const, text: 'done' }),
    };
  }

  it('posts a consent card to the active conversationId and resolves to accept on approve', async () => {
    const adapter = new FakeAdapter();
    const brain = idleBrain();
    const store = new SessionStore(brain.newSession);
    const fakeMcp = new FakeMcpWithElicit();
    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as import('./mcp.js').PeekMcp,
      store,
    });
    await runtime.start();

    // Simulate a turn starting for conversation t1 — fire a message to make the runtime
    // set #activeConversationId. The idleBrain never resolves, so the turn stays active.
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'go' });
    // Give the event loop a tick to enter runTurn (which never resolves)
    await new Promise((r) => setTimeout(r, 10));

    // Now invoke the registered elicit handler (as peek-mcp would)
    expect(fakeMcp.elicitCb).toBeDefined();
    const elicitPromise = fakeMcp.elicitCb?.('Allow peek to click the submit button?');

    // The runtime should post a consent card to t1
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));
    const postedConvId = adapter.consents[0]?.[0];
    const postedReq = adapter.consents[0]?.[1];
    expect(postedConvId).toBe('t1');
    expect(postedReq?.correlationId).toBeTruthy();

    // Simulate the human approving
    adapter.consentHandler?.({
      conversationId: 't1',
      correlationId: postedReq?.correlationId ?? '',
      decision: 'approve',
    });
    const result = await elicitPromise;
    expect(result).toBe('accept');
  });

  it('resolves to decline when the human denies', async () => {
    const adapter = new FakeAdapter();
    const brain = idleBrain();
    const store = new SessionStore(brain.newSession);
    const fakeMcp = new FakeMcpWithElicit();
    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as import('./mcp.js').PeekMcp,
      store,
    });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'go' });
    await new Promise((r) => setTimeout(r, 10));

    const elicitPromise = fakeMcp.elicitCb?.('Allow peek to type into the field?');
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));
    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';

    adapter.consentHandler?.({ conversationId: 't1', correlationId, decision: 'deny' });
    const result = await elicitPromise;
    expect(result).toBe('decline');
  });

  it('does not resolve the elicit when the correlationId is stale/mismatched', async () => {
    const adapter = new FakeAdapter();
    const brain = idleBrain();
    const store = new SessionStore(brain.newSession);
    const fakeMcp = new FakeMcpWithElicit();
    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as import('./mcp.js').PeekMcp,
      store,
    });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'go' });
    await new Promise((r) => setTimeout(r, 10));

    let resolved = false;
    fakeMcp.elicitCb?.('Allow action?').then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));

    // Send a response with the WRONG correlationId
    adapter.consentHandler?.({ conversationId: 't1', correlationId: 'WRONG', decision: 'approve' });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
  });

  it('returns cancel when no turn is active', async () => {
    const adapter = new FakeAdapter();
    const brain = doneBrain();
    const store = new SessionStore(brain.newSession);
    const fakeMcp = new FakeMcpWithElicit();
    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as import('./mcp.js').PeekMcp,
      store,
    });
    await runtime.start();
    // No message sent — no active turn
    const result = await fakeMcp.elicitCb?.('Allow action?');
    expect(result).toBe('cancel');
  });
});

describe('ConnectorRuntime abandoned-elicit wedge (SP3a fix)', () => {
  class FakeMcpWithElicit {
    callTool = vi.fn().mockResolvedValue('ok');
    elicitCb?: (message: string) => Promise<'accept' | 'decline' | 'cancel'>;
    onElicit(cb: (message: string) => Promise<'accept' | 'decline' | 'cancel'>) {
      this.elicitCb = cb;
    }
  }

  it('resolves abandoned pending elicit to decline and unblocks future elicitations when runTurn times out', async () => {
    // Brain that rejects after a short delay — simulating the 30s callTool timeout
    // firing while a delegated elicit is still awaiting a human answer.
    let rejectTurn!: (err: Error) => void;
    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () =>
        new Promise<AgentOutcome>((_resolve, reject) => {
          rejectTurn = reject;
        }),
    };

    const adapter = new FakeAdapter();
    const store = new SessionStore(brain.newSession);
    const fakeMcp = new FakeMcpWithElicit();
    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as import('./mcp.js').PeekMcp,
      store,
    });
    await runtime.start();

    // Start a turn for conversation t1 — runTurn will park until we call rejectTurn.
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'go' });
    // Give the event loop a tick so runTurn is actually awaited and #activeConversationId is set.
    await new Promise((r) => setTimeout(r, 10));

    // Invoke the elicit handler — it should post a consent card and park on the human's answer.
    expect(fakeMcp.elicitCb).toBeDefined();
    let abandonedResult: 'accept' | 'decline' | 'cancel' | undefined;
    const elicitPromise = fakeMcp.elicitCb?.('Allow action?').then((v) => {
      abandonedResult = v;
      return v;
    });

    // Consent card should have been posted.
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));

    // The human never answers. Instead, runTurn times out / rejects.
    rejectTurn(new Error('callTool timed out after 30000ms'));

    // runLoop's finally should clear #pendingElicit and resolve the abandoned elicit with 'decline'.
    await elicitPromise;
    expect(abandonedResult).toBe('decline');

    // (a) The abandoned elicit resolved to 'decline' — safe deny, action did NOT run.

    // (b) Now assert a SUBSEQUENT elicit is NOT blocked.
    // Start a fresh turn for conversation t1.
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'try again' });
    await new Promise((r) => setTimeout(r, 10));

    // Trigger a new elicit — it must post a NEW consent card (not return 'cancel').
    const prevConsentCount = adapter.consents.length;
    // The fresh turn's runTurn is still parked. We just need to confirm the elicit
    // handler goes through rather than short-circuits with 'cancel'.
    const secondElicitPromise = fakeMcp.elicitCb?.('Allow next action?');
    await vi.waitFor(() => expect(adapter.consents.length).toBeGreaterThan(prevConsentCount));

    // Confirm by resolving the second elicit normally (approve it).
    const newCorrelationId = adapter.consents[adapter.consents.length - 1]?.[1].correlationId ?? '';
    adapter.consentHandler?.({
      conversationId: 't1',
      correlationId: newCorrelationId,
      decision: 'approve',
    });
    const secondResult = await secondElicitPromise;
    expect(secondResult).toBe('accept');
  });
});

describe('ConnectorRuntime handler rejection', () => {
  it('does not produce an unhandled rejection when handleMessage rejects', async () => {
    // A brain whose runTurn always rejects
    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => {
        throw new Error('brain exploded');
      },
    };

    // A FakeAdapter whose postText also rejects — so runLoop's catch handler throws too
    class FailingAdapter extends FakeAdapter {
      override async postText(_c: string, _t: string) {
        throw new Error('postText also failed');
      }
    }

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const adapter = new FailingAdapter();
      const store = new SessionStore(brain.newSession);
      const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
      const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
      await runtime.start();

      // Fire the handler — this should NOT throw or produce an unhandled rejection
      adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'hi' });

      // Wait a tick for the async chain to settle
      await new Promise((r) => setTimeout(r, 20));

      // The test completing without crashing = no unhandled rejection
      // console.error should have been called with the error
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
