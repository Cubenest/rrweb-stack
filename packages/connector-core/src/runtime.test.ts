import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { AgentOutcome, Brain, Session } from './brain.js';
import type { PeekMcp } from './mcp.js';
import { ConnectorRuntime, classifyError } from './runtime.js';
import { SdkBrain } from './sdk-brain.js';
import type { SecretStore } from './secret-store.js';
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

describe('ConnectorRuntime turn serialization (concurrency clobber fix)', () => {
  class FakeMcpWithElicit {
    callTool = vi.fn().mockResolvedValue('ok');
    elicitCb?: (message: string) => Promise<'accept' | 'decline' | 'cancel'>;
    onElicit(cb: (message: string) => Promise<'accept' | 'decline' | 'cancel'>) {
      this.elicitCb = cb;
    }
  }

  it('does not start the second turn until the first completes', async () => {
    // Brain records call order and parks on the first turn until unblocked.
    const runOrder: number[] = [];
    let unblockFirst!: () => void;
    let firstStarted = false;

    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => {
        if (!firstStarted) {
          firstStarted = true;
          runOrder.push(1);
          await new Promise<void>((resolve) => {
            unblockFirst = resolve;
          });
          return { kind: 'done' as const, text: 'first' };
        }
        runOrder.push(2);
        return { kind: 'done' as const, text: 'second' };
      },
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

    // Dispatch two messages without awaiting the first.
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'first message' });
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'second message' });

    // Give the event loop a tick — first turn should have started, second should NOT yet.
    await new Promise((r) => setTimeout(r, 10));
    expect(runOrder).toEqual([1]); // second hasn't started

    // Unblock the first turn and wait for both to complete.
    unblockFirst();
    await vi.waitFor(() => expect(adapter.texts).toHaveLength(2));
    expect(runOrder).toEqual([1, 2]); // strict ordering: 1 before 2
  });

  it('an elicit fired during turn 1 targets conversation 1, not conversation 2', async () => {
    // Turn 1 parks at elicitInput; turn 2 is queued. The elicit card must go to conv-1.
    let unblockFirst!: () => void;
    let firstStarted = false;

    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => {
        if (!firstStarted) {
          firstStarted = true;
          // Park until unblocked — simulates a long-running turn with in-flight elicit.
          await new Promise<void>((resolve) => {
            unblockFirst = resolve;
          });
          return { kind: 'done' as const, text: 'first done' };
        }
        return { kind: 'done' as const, text: 'second done' };
      },
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

    // Start turn 1 (conversation c1) — parks inside runTurn.
    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'turn 1' });
    // Queue turn 2 (conversation c2) — must wait behind turn 1 in the chain.
    adapter.msgHandler?.({ conversationId: 'c2', userId: 'u', text: 'turn 2' });

    // Give the event loop a tick so turn 1 is active and turn 2 is queued.
    await new Promise((r) => setTimeout(r, 10));

    // Fire an elicit while turn 1 is active — the consent card MUST go to c1.
    expect(fakeMcp.elicitCb).toBeDefined();
    const elicitPromise = fakeMcp.elicitCb?.('Allow action on c1?');

    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));
    const targetConvId = adapter.consents[0]?.[0];
    expect(targetConvId).toBe('c1'); // elicit targeted the active turn's conversation

    // Approve the elicit and confirm it resolves correctly.
    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';
    adapter.consentHandler?.({ conversationId: 'c1', correlationId, decision: 'approve' });
    const elicitResult = await elicitPromise;
    expect(elicitResult).toBe('accept');

    // Now unblock turn 1 so the chain can proceed.
    unblockFirst();
    await vi.waitFor(() => expect(adapter.texts).toHaveLength(2));
  });
});

describe('classifyError', () => {
  // Real thrown-message grounding (verified against source before writing fixtures):
  // - mcp connect: withTimeout label='mcp connect' → "mcp connect timed out after 10000ms"
  // - mcp callTool: withTimeout label=`mcp callTool(${name})` → "mcp callTool(list_recent_sessions) timed out after 30000ms"
  // - 401 auth: AuthenticationError.makeMessage → "401 {message from API}" (contains '401')
  // - connection error: APIConnectionError → "Connection error." (contains 'connection error')
  // - max-turns: SdkBrain → "SdkBrain exceeded 16 tool-use turns" (contains 'tool-use turns')
  //   NOTE: brief fixtures used 'Exceeded maxTurns (16) without a final answer' — WRONG.
  //   Real message does NOT contain 'maxturns', 'max turns', or 'max-turns'. Fixed here.
  const cases: Array<[unknown, string]> = [
    [new Error('mcp connect timed out after 10000ms'), 'mcp-connection-lost'],
    [new Error('mcp callTool(list_recent_sessions) timed out after 30000ms'), 'tool-error'],
    [
      new Error('401 {"message":"invalid x-api-key","type":"authentication_error"}'),
      'llm-key-rejected',
    ],
    [new Error('Connection error.'), 'llm-endpoint-error'],
    [new Error('No recording found for this browser session'), 'not-recording'],
    [new Error('elicitInput deny reason: timeout'), 'consent-timeout'],
    [new Error('SdkBrain exceeded 16 tool-use turns'), 'max-turns'],
    ['a bare string with no signal', 'unknown'],
    [{ weird: true }, 'unknown'],
  ];
  for (const [err, kind] of cases) {
    it(`classifies ${kind}`, () => {
      const out = classifyError(err);
      expect(out.kind).toBe(kind);
      expect(out.headline.length).toBeGreaterThan(0);
      expect(out.hint.length).toBeGreaterThan(0);
    });
  }
});

describe('runLoop error legibility', () => {
  it('calls postError with a classified kind when a turn throws', async () => {
    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => {
        throw new Error('401 {"message":"invalid x-api-key","type":"authentication_error"}');
      },
    };
    class ErrAdapter extends FakeAdapter {
      errors: Array<[string, { kind: string; headline: string; hint: string }]> = [];
      async postError(c: string, e: { kind: string; headline: string; hint: string }) {
        this.errors.push([c, e]);
      }
    }
    const adapter = new ErrAdapter();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'hi' });
    await vi.waitFor(() => expect(adapter.errors).toHaveLength(1));
    expect(adapter.errors[0]?.[1].kind).toBe('llm-key-rejected');
    expect(adapter.texts).toHaveLength(0); // used postError, not plain text
  });

  it('falls back to postText when the adapter has no postError', async () => {
    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => {
        throw new Error('boom');
      },
    };
    const adapter = new FakeAdapter(); // no postError
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();
    adapter.msgHandler?.({ conversationId: 't1', userId: 'u', text: 'hi' });
    await vi.waitFor(() => expect(adapter.texts).toHaveLength(1));
    expect(adapter.texts[0]?.[0]).toBe('t1');
    // The composed text must contain the classified headline AND hint for the unknown kind.
    // classifyError('boom') → kind:'unknown', headline:'Something went wrong reaching peek',
    // hint:'Please try again. If it keeps happening, check the connector logs.'
    const postedText = adapter.texts[0]?.[1] ?? '';
    expect(postedText).toContain('Something went wrong reaching peek');
    expect(postedText).toContain('Please try again');
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

// ---------------------------------------------------------------------------
// SP6a pairing tests — runtime uses injected SecretStore keyed by mcp.clientName
// ---------------------------------------------------------------------------

/** Minimal in-memory SecretStore for tests. */
class InMemorySecretStore implements SecretStore {
  readonly #map = new Map<string, string>();

  async get(connectorId: string, name: string): Promise<string | null> {
    return this.#map.get(`${connectorId}:${name}`) ?? null;
  }

  async set(connectorId: string, name: string, secret: string): Promise<void> {
    this.#map.set(`${connectorId}:${name}`, secret);
  }

  async delete(connectorId: string, name: string): Promise<void> {
    this.#map.delete(`${connectorId}:${name}`);
  }
}

function makeBaseDeps() {
  const brain: Brain = {
    newSession: (): Session => ({ history: [] }),
    appendUserText: () => {},
    appendToolResult: () => {},
    runTurn: async () => ({ kind: 'done' as const, text: 'ok' }),
  };
  const adapter = new FakeAdapter();
  const store = new SessionStore(brain.newSession);
  return { brain, adapter, store };
}

describe('ConnectorRuntime pair()', () => {
  class FakeMcpForPairing {
    readonly clientName = 'peek-test';
    callTool = vi.fn().mockResolvedValue('ok');
    onElicit = vi.fn();
    setConnectorSecret = vi.fn();
    requestPairingResult: { approved: boolean; secret?: string } = {
      approved: true,
      secret: 'tok-123',
    };
    requestPairing = vi.fn(async (_code: string) => this.requestPairingResult);
  }

  it('generates a 4-digit numeric code and passes it to displayCode callback', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    const secretStore = new InMemorySecretStore();

    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      secretStore,
    });

    const displayedCodes: string[] = [];
    await runtime.pair((code) => {
      displayedCodes.push(code);
    });

    expect(displayedCodes).toHaveLength(1);
    const code = displayedCodes[0] ?? '';
    expect(code).toMatch(/^\d{4}$/); // exactly 4 digits
  });

  it('calls requestPairing with the generated code', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    const secretStore = new InMemorySecretStore();

    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      secretStore,
    });

    const displayedCodes: string[] = [];
    await runtime.pair((code) => {
      displayedCodes.push(code);
    });

    expect(fakeMcp.requestPairing).toHaveBeenCalledWith(displayedCodes[0]);
  });

  it('persists the secret keyed by mcp.clientName and calls setConnectorSecret on approval', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    fakeMcp.requestPairingResult = { approved: true, secret: 'approved-secret-xyz' };
    const secretStore = new InMemorySecretStore();

    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      secretStore,
    });
    const result = await runtime.pair((_code) => {});

    expect(result).toBe(true);
    // SecretStore keyed by mcp.clientName ('peek-test') + 'pairing'
    expect(await secretStore.get('peek-test', 'pairing')).toBe('approved-secret-xyz');
    expect(fakeMcp.setConnectorSecret).toHaveBeenCalledWith('approved-secret-xyz');
  });

  it('returns false and does not persist when pairing is denied', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    fakeMcp.requestPairingResult = { approved: false };
    const secretStore = new InMemorySecretStore();

    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      secretStore,
    });
    const result = await runtime.pair((_code) => {});

    expect(result).toBe(false);
    expect(await secretStore.get('peek-test', 'pairing')).toBeNull();
    expect(fakeMcp.setConnectorSecret).not.toHaveBeenCalled();
  });

  it('throws if secretStore is absent', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      // no secretStore
    });
    await expect(runtime.pair((_code) => {})).rejects.toThrow('pair() requires secretStore');
  });
});

describe('ConnectorRuntime start() loads existing secret', () => {
  class FakeMcpForPairing {
    readonly clientName = 'peek-test';
    callTool = vi.fn().mockResolvedValue('ok');
    onElicit = vi.fn();
    setConnectorSecret = vi.fn();
    requestPairing = vi.fn();
  }

  it('loads an existing secret from the store keyed by mcp.clientName and calls setConnectorSecret on start()', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    const secretStore = new InMemorySecretStore();
    // Pre-populate the store with a secret for 'peek-test'
    await secretStore.set('peek-test', 'pairing', 'existing-secret-abc');

    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      secretStore,
    });
    await runtime.start();

    expect(fakeMcp.setConnectorSecret).toHaveBeenCalledWith('existing-secret-abc');
  });

  it('does not call setConnectorSecret when no secret exists on start()', async () => {
    const { brain, adapter, store } = makeBaseDeps();
    const fakeMcp = new FakeMcpForPairing();
    const secretStore = new InMemorySecretStore(); // empty

    const runtime = new ConnectorRuntime({
      adapter,
      brain,
      mcp: fakeMcp as unknown as PeekMcp,
      store,
      secretStore,
    });
    await runtime.start();

    expect(fakeMcp.setConnectorSecret).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// share_session interception tests (Task 3)
// ---------------------------------------------------------------------------

/** Extend FakeAdapter with postFile tracking. */
class FileAdapter extends FakeAdapter {
  postFileCalls: Array<{
    conversationId: string;
    filePath: string;
    filename: string;
    comment: string;
  }> = [];
  async postFile(conversationId: string, filePath: string, filename: string, comment?: string) {
    this.postFileCalls.push({ conversationId, filePath, filename, comment: comment ?? '' });
  }
}

function anthropicMsg(
  content: Anthropic.ContentBlock[],
  stop: Anthropic.Message['stop_reason'],
): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'x',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as Anthropic.Message;
}

/** A createMessage mock that first emits a `share_session` tool_use (a READ tool,
 *  so SdkBrain runs it INLINE via its injected callTool — never as a consent
 *  outcome), then a plain text end_turn once the tool result is fed back. */
function shareSessionCreateMessage(): (
  req: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message> {
  return vi
    .fn()
    .mockResolvedValueOnce(
      anthropicMsg(
        [
          {
            type: 'tool_use',
            id: 'tu-share-1',
            name: 'share_session',
            input: { sessionId: 's1', surface: 'slack' },
            caller: { type: 'direct' },
          } as Anthropic.ContentBlock,
        ],
        'tool_use',
      ),
    )
    .mockResolvedValueOnce(
      anthropicMsg([{ type: 'text', text: 'shared', citations: [] }], 'end_turn'),
    );
}

/**
 * Build a runtime wired to a REAL SdkBrain whose injected callTool routes through
 * `runtime.interceptCallTool(...)` — exactly as the connector-slack composition
 * root does. `innerCallTool` is the mocked low-level MCP callTool. This is the
 * production path: share_session is read-classified, so SdkBrain calls it inline
 * and the result flows through interceptCallTool, NOT handleConsentResponse.
 *
 * This mirroring is the whole point of the Critical fix — a test that drove a
 * synthetic {kind:'consent'} brain (as commit 09219fc's tests did) would exercise
 * the WRONG path and pass even though the interception never fires in production.
 */
function makeRealBrainRuntime(deps: {
  adapter: SurfaceAdapter;
  innerCallTool: (name: string, input: unknown) => Promise<string>;
}): { runtime: ConnectorRuntime } {
  // Forward reference — mirrors the connector-slack composition root's construction-time
  // dependency cycle (the brain's callTool closes over the runtime).
  // biome-ignore lint/style/useConst: forward reference for a construction-time dependency cycle
  let runtimeRef: ConnectorRuntime;
  const brain = new SdkBrain({
    createMessage: shareSessionCreateMessage(),
    callTool: (name, input) =>
      runtimeRef.interceptCallTool(name, input, (n, i) => deps.innerCallTool(n, i)),
    tools: [],
    model: 'm',
    extendedReasoning: false,
  });
  const store = new SessionStore(() => brain.newSession());
  // The runtime only touches mcp.callTool on the consent path; on the read path
  // it is never called. A stub keeps the type happy.
  const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
  const runtime = new ConnectorRuntime({ adapter: deps.adapter, brain, mcp, store });
  runtimeRef = runtime;
  return { runtime };
}

describe('share_session interception — REAL SdkBrain inline (read) routing', () => {
  it('MANDATORY: an approved share_session from the real SdkBrain triggers postFile + temp-file delete', async () => {
    // Real temp file so deletion is observable.
    const dir = await mkdtemp(join(tmpdir(), 'peek-test-'));
    const bundlePath = join(dir, 'session.peekbundle');
    await writeFile(bundlePath, 'bundle-data');

    const toolResult = JSON.stringify({
      ok: true,
      bundlePath,
      filename: 'session.peekbundle',
      sizeBytes: 11,
      caveat: 'contains data',
    });
    // Low-level MCP callTool the brain drives INLINE (share_session is read).
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    const adapter = new FileAdapter();
    const { runtime } = makeRealBrainRuntime({ adapter, innerCallTool });
    await runtime.start();

    // Drive a real turn end-to-end: message -> SdkBrain.runTurn -> inline
    // callTool(share_session) -> interceptCallTool -> postFile + delete.
    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share my session' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // The brain ran share_session inline (never a consent outcome).
    expect(innerCallTool).toHaveBeenCalledWith('share_session', {
      sessionId: 's1',
      surface: 'slack',
    });
    // No consent card was ever posted (proves the read/inline path, not consent).
    expect(adapter.consents).toHaveLength(0);

    // postFile fired with the active conversationId + bundle args.
    expect(adapter.postFileCalls).toHaveLength(1);
    expect(adapter.postFileCalls[0]?.conversationId).toBe('c1');
    expect(adapter.postFileCalls[0]?.filePath).toBe(bundlePath);
    expect(adapter.postFileCalls[0]?.filename).toBe('session.peekbundle');

    // Temp file deleted.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it('deletes the temp file even when upload (postFile) throws — try/finally guarantee', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'peek-test-'));
    const bundlePath = join(dir, 'session.peekbundle');
    await writeFile(bundlePath, 'bundle-data');

    const toolResult = JSON.stringify({
      ok: true,
      bundlePath,
      filename: 'session.peekbundle',
      sizeBytes: 11,
      caveat: '',
    });
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    class ThrowingFileAdapter extends FakeAdapter {
      async postFile(_c: string, _fp: string, _fn: string, _comment?: string): Promise<void> {
        throw new Error('Slack upload failed');
      }
    }

    const adapter = new ThrowingFileAdapter();
    const { runtime } = makeRealBrainRuntime({ adapter, innerCallTool });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share' });
    // The upload error is surfaced to the brain as the tool result; the brain's
    // second createMessage still returns end_turn 'shared', so the turn completes.
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // Temp file deleted despite the upload failure.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it('does not call postFile and does not throw when result is { ok: false }', async () => {
    const toolResult = JSON.stringify({ ok: false, result: 'denied', reason: 'user denied' });
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);
    const adapter = new FileAdapter();
    const { runtime } = makeRealBrainRuntime({ adapter, innerCallTool });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    expect(adapter.postFileCalls).toHaveLength(0);
  });

  it('degrades to a filename-only text note (no raw temp path) when adapter.postFile is undefined, and still deletes the temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'peek-test-'));
    const bundlePath = join(dir, 'session.peekbundle');
    await writeFile(bundlePath, 'bundle-data');

    const toolResult = JSON.stringify({
      ok: true,
      bundlePath,
      filename: 'session.peekbundle',
      sizeBytes: 11,
      caveat: '',
    });

    // Capture the tool-result text fed back to the brain so we can assert the
    // degrade note references the filename only and never the raw OS temp path.
    let feedbackText = '';
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    // FakeAdapter has no postFile. The second createMessage captures the
    // tool_result the interception fed back to the brain, so we can assert the
    // degrade note references the filename only (never the raw OS temp path).
    // biome-ignore lint/style/useConst: forward reference (dependency cycle — see makeRealBrainRuntime).
    let runtimeRef: ConnectorRuntime;
    const createMessage = vi
      .fn()
      .mockResolvedValueOnce(
        anthropicMsg(
          [
            {
              type: 'tool_use',
              id: 'tu-share-1',
              name: 'share_session',
              input: { sessionId: 's1', surface: 'slack' },
              caller: { type: 'direct' },
            } as Anthropic.ContentBlock,
          ],
          'tool_use',
        ),
      )
      .mockImplementationOnce((req: Anthropic.MessageCreateParamsNonStreaming) => {
        // The last user message carries the tool_result the interception produced.
        const last = req.messages.at(-1) as { content: Anthropic.ToolResultBlockParam[] };
        const block = last.content.find((b) => b.tool_use_id === 'tu-share-1');
        feedbackText = typeof block?.content === 'string' ? block.content : '';
        return Promise.resolve(
          anthropicMsg([{ type: 'text', text: 'shared', citations: [] }], 'end_turn'),
        );
      });

    const adapter = new FakeAdapter(); // no postFile
    const brain = new SdkBrain({
      createMessage,
      callTool: (name, input) =>
        runtimeRef.interceptCallTool(name, input, (n, i) => innerCallTool(n, i)),
      tools: [],
      model: 'm',
      extendedReasoning: false,
    });
    const store = new SessionStore(() => brain.newSession());
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    runtimeRef = runtime;
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // The degrade note references the filename, never the raw OS temp path.
    expect(feedbackText).toContain('session.peekbundle');
    expect(feedbackText).not.toContain(bundlePath);
    expect(feedbackText).not.toContain(dir);

    // Temp file still deleted.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// render_session_journey interception tests (Task 2)
// ---------------------------------------------------------------------------

/** Minimal CausalChain-shaped fixture — mirrors the real CausalChain from peek-mcp. */
const CAUSAL_CHAIN_FIXTURE = {
  errorId: 42,
  errorTs: 1700000000000,
  windowMs: 5000,
  error: { id: 42, message: 'TypeError: Cannot read properties of null', level: 'error' },
  actions: [{ ts: 1699999997000, verb: 'click', target: 'button#submit' }],
  domMutations: [],
  networkErrors: [],
  timeline: [
    { ts: 1699999997000, relMs: -3000, kind: 'action', summary: 'click button#submit' },
    {
      ts: 1700000000000,
      relMs: 0,
      kind: 'error',
      summary: 'TypeError: Cannot read properties of null',
    },
  ],
  narrative: 'User clicked button#submit 3s before a TypeError.',
  truncated: {},
};

/** A createMessage mock that emits `render_session_journey` tool_use (a READ tool),
 *  then end_turn once the tool result is fed back. */
function renderJourneyCreateMessage(): (
  req: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message> {
  return vi
    .fn()
    .mockResolvedValueOnce(
      anthropicMsg(
        [
          {
            type: 'tool_use',
            id: 'tu-journey-1',
            name: 'render_session_journey',
            input: { sessionId: 's1', errorId: 42 },
            caller: { type: 'direct' },
          } as Anthropic.ContentBlock,
        ],
        'tool_use',
      ),
    )
    .mockResolvedValueOnce(
      anthropicMsg([{ type: 'text', text: 'journey rendered', citations: [] }], 'end_turn'),
    );
}

/** Build a runtime wired to a REAL SdkBrain for render_session_journey interception tests.
 *  Mirrors makeRealBrainRuntime but uses the render_session_journey createMessage mock. */
function makeJourneyBrainRuntime(deps: {
  adapter: SurfaceAdapter;
  innerCallTool: (name: string, input: unknown) => Promise<string>;
}): { runtime: ConnectorRuntime } {
  // biome-ignore lint/style/useConst: forward reference for a construction-time dependency cycle
  let runtimeRef: ConnectorRuntime;
  const brain = new SdkBrain({
    createMessage: renderJourneyCreateMessage(),
    callTool: (name, input) =>
      runtimeRef.interceptCallTool(name, input, (n, i) => deps.innerCallTool(n, i)),
    tools: [],
    model: 'm',
    extendedReasoning: false,
  });
  const store = new SessionStore(() => brain.newSession());
  const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
  const runtime = new ConnectorRuntime({ adapter: deps.adapter, brain, mcp, store });
  runtimeRef = runtime;
  return { runtime };
}

/** Extend FakeAdapter with renderJourney tracking. */
class JourneyAdapter extends FakeAdapter {
  renderJourneyCalls: Array<{ conversationId: string; journey: unknown }> = [];
  readonly confirmationText: string;
  constructor(confirmationText = 'Session journey posted to canvas.') {
    super();
    this.confirmationText = confirmationText;
  }
  async renderJourney(conversationId: string, journey: unknown): Promise<string> {
    this.renderJourneyCalls.push({ conversationId, journey });
    return this.confirmationText;
  }
}

describe('render_session_journey interception — REAL SdkBrain inline (read) routing', () => {
  it('(a) CausalChain result → adapter.renderJourney called with (conversationId, journey); brain receives confirmation not raw timeline', async () => {
    const toolResult = JSON.stringify(CAUSAL_CHAIN_FIXTURE);
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    const adapter = new JourneyAdapter('https://canvas.example.com/journey/42');
    const { runtime } = makeJourneyBrainRuntime({ adapter, innerCallTool });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'show session journey' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'journey rendered']));

    // renderJourney fired exactly once.
    expect(adapter.renderJourneyCalls).toHaveLength(1);
    expect(adapter.renderJourneyCalls[0]?.conversationId).toBe('c1');

    // The journey object passed to renderJourney has timeline + narrative.
    const journey = adapter.renderJourneyCalls[0]?.journey as typeof CAUSAL_CHAIN_FIXTURE;
    expect(journey).toHaveProperty('timeline');
    expect(journey).toHaveProperty('narrative');
    expect(Array.isArray(journey.timeline)).toBe(true);

    // The brain received the confirmation string (not the raw CausalChain JSON).
    // We can verify indirectly: the innerCallTool returned the full JSON, but
    // the turn completed with the confirmation — so the brain fed the confirmation
    // into the next createMessage call (which returned 'journey rendered' end_turn).
    expect(innerCallTool).toHaveBeenCalledWith('render_session_journey', {
      sessionId: 's1',
      errorId: 42,
    });
    // No consent card posted (proves the read/inline path).
    expect(adapter.consents).toHaveLength(0);
  });

  it('(a-confirm) brain receives confirmation string, NOT the raw CausalChain JSON — verified via createMessage inspection', async () => {
    const toolResult = JSON.stringify(CAUSAL_CHAIN_FIXTURE);
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    // Custom createMessage that captures the tool_result fed back to the brain.
    let feedbackToModel = '';
    // biome-ignore lint/style/useConst: forward reference for a construction-time dependency cycle
    let runtimeRef2: ConnectorRuntime;
    const createMsg = vi
      .fn()
      .mockResolvedValueOnce(
        anthropicMsg(
          [
            {
              type: 'tool_use',
              id: 'tu-journey-confirm',
              name: 'render_session_journey',
              input: { sessionId: 's1', errorId: 42 },
              caller: { type: 'direct' },
            } as Anthropic.ContentBlock,
          ],
          'tool_use',
        ),
      )
      .mockImplementationOnce((req: Anthropic.MessageCreateParamsNonStreaming) => {
        const last = req.messages.at(-1) as { content: Anthropic.ToolResultBlockParam[] };
        const block = last.content.find((b) => b.tool_use_id === 'tu-journey-confirm');
        feedbackToModel = typeof block?.content === 'string' ? block.content : '';
        return Promise.resolve(
          anthropicMsg([{ type: 'text', text: 'done', citations: [] }], 'end_turn'),
        );
      });

    const confirmText = 'Canvas posted: https://canvas.example.com/journey/42';
    const adapter = new JourneyAdapter(confirmText);
    const brain = new SdkBrain({
      createMessage: createMsg,
      callTool: (name, input) =>
        runtimeRef2.interceptCallTool(name, input, (n, i) => innerCallTool(n, i)),
      tools: [],
      model: 'm',
      extendedReasoning: false,
    });
    const store = new SessionStore(() => brain.newSession());
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime2 = new ConnectorRuntime({ adapter, brain, mcp, store });
    runtimeRef2 = runtime2;
    await runtime2.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'journey' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'done']));

    // The model received the confirmation string — NOT the raw CausalChain JSON.
    expect(feedbackToModel).toBe(confirmText);
    expect(feedbackToModel).not.toContain('"timeline"');
    expect(feedbackToModel).not.toContain('"narrative"');
    expect(feedbackToModel).not.toContain('"domMutations"');
  });

  it('(b) adapter without renderJourney → degrades to a text note, no throw', async () => {
    const toolResult = JSON.stringify(CAUSAL_CHAIN_FIXTURE);
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    // Capture what the brain receives as the tool_result text.
    let feedbackToModel = '';
    // biome-ignore lint/style/useConst: forward reference for a construction-time dependency cycle
    let runtimeRef3: ConnectorRuntime;
    const createMsg = vi
      .fn()
      .mockResolvedValueOnce(
        anthropicMsg(
          [
            {
              type: 'tool_use',
              id: 'tu-journey-degrade',
              name: 'render_session_journey',
              input: { sessionId: 's1' },
              caller: { type: 'direct' },
            } as Anthropic.ContentBlock,
          ],
          'tool_use',
        ),
      )
      .mockImplementationOnce((req: Anthropic.MessageCreateParamsNonStreaming) => {
        const last = req.messages.at(-1) as { content: Anthropic.ToolResultBlockParam[] };
        const block = last.content.find((b) => b.tool_use_id === 'tu-journey-degrade');
        feedbackToModel = typeof block?.content === 'string' ? block.content : '';
        return Promise.resolve(
          anthropicMsg([{ type: 'text', text: 'done', citations: [] }], 'end_turn'),
        );
      });

    const adapter = new FakeAdapter(); // no renderJourney
    const brain = new SdkBrain({
      createMessage: createMsg,
      callTool: (name, input) =>
        runtimeRef3.interceptCallTool(name, input, (n, i) => innerCallTool(n, i)),
      tools: [],
      model: 'm',
      extendedReasoning: false,
    });
    const store = new SessionStore(() => brain.newSession());
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime3 = new ConnectorRuntime({ adapter, brain, mcp, store });
    runtimeRef3 = runtime3;
    await runtime3.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'journey' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'done']));

    // The degrade note is brief and does NOT contain the raw timeline JSON.
    expect(feedbackToModel).toContain('cannot render');
    expect(feedbackToModel).not.toContain('"timeline"');
    expect(feedbackToModel).not.toContain('"narrative"');
  });

  it('(c) a non-render_session_journey tool result passes through unchanged', async () => {
    // intercept a plain tool result for some_other_tool — must not be modified.
    const plainResult = 'just a plain tool result string';
    const innerCallTool = vi.fn().mockResolvedValue(plainResult);

    let feedbackToModel = '';
    // biome-ignore lint/style/useConst: forward reference for a construction-time dependency cycle
    let runtimeRef4: ConnectorRuntime;
    const createMsg = vi
      .fn()
      .mockResolvedValueOnce(
        anthropicMsg(
          [
            {
              type: 'tool_use',
              id: 'tu-other-1',
              name: 'list_recent_sessions',
              input: {},
              caller: { type: 'direct' },
            } as Anthropic.ContentBlock,
          ],
          'tool_use',
        ),
      )
      .mockImplementationOnce((req: Anthropic.MessageCreateParamsNonStreaming) => {
        const last = req.messages.at(-1) as { content: Anthropic.ToolResultBlockParam[] };
        const block = last.content.find((b) => b.tool_use_id === 'tu-other-1');
        feedbackToModel = typeof block?.content === 'string' ? block.content : '';
        return Promise.resolve(
          anthropicMsg([{ type: 'text', text: 'done', citations: [] }], 'end_turn'),
        );
      });

    const adapter = new JourneyAdapter(); // has renderJourney, but must NOT be called
    const brain = new SdkBrain({
      createMessage: createMsg,
      callTool: (name, input) =>
        runtimeRef4.interceptCallTool(name, input, (n, i) => innerCallTool(n, i)),
      tools: [],
      model: 'm',
      extendedReasoning: false,
    });
    const store = new SessionStore(() => brain.newSession());
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime4 = new ConnectorRuntime({ adapter, brain, mcp, store });
    runtimeRef4 = runtime4;
    await runtime4.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'list sessions' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'done']));

    // Passed through unchanged.
    expect(feedbackToModel).toBe(plainResult);
    // renderJourney was NOT called.
    expect(adapter.renderJourneyCalls).toHaveLength(0);
  });

  it('(d) share_session interception still works alongside render_session_journey interception', async () => {
    // Minimal regression: share_session path still triggers postFile.
    const dir = await mkdtemp(join(tmpdir(), 'peek-test-'));
    const bundlePath = join(dir, 'session.peekbundle');
    await writeFile(bundlePath, 'bundle-data');

    const toolResult = JSON.stringify({
      ok: true,
      bundlePath,
      filename: 'session.peekbundle',
      sizeBytes: 11,
      caveat: '',
    });
    const innerCallTool = vi.fn().mockResolvedValue(toolResult);

    class CombinedAdapter extends JourneyAdapter {
      postFileCalls: Array<{ conversationId: string; filePath: string; filename: string }> = [];
      async postFile(c: string, fp: string, fn: string, _comment?: string): Promise<void> {
        this.postFileCalls.push({ conversationId: c, filePath: fp, filename: fn });
      }
    }
    const adapter = new CombinedAdapter('canvas-link');
    const { runtime } = makeRealBrainRuntime({ adapter, innerCallTool });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share session' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // share_session still triggered postFile.
    expect(adapter.postFileCalls).toHaveLength(1);
    expect(adapter.postFileCalls[0]?.conversationId).toBe('c1');

    // renderJourney was NOT called (wrong tool name).
    expect(adapter.renderJourneyCalls).toHaveLength(0);

    // Temp file deleted.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it('(e) plain-text result for render_session_journey passes through unchanged, renderJourney NOT called', async () => {
    // peek-mcp returns plain text (e.g. "no console errors found") when there is
    // nothing to render. interceptCallTool must return that text as-is — no JSON
    // parse attempt, no renderJourney call, no throw.
    const plainText = 'No console errors found for this session.';
    const innerCallTool = vi.fn().mockResolvedValue(plainText);

    let feedbackToModel = '';
    // biome-ignore lint/style/useConst: forward reference for a construction-time dependency cycle
    let runtimeRef5: ConnectorRuntime;
    const createMsg = vi
      .fn()
      .mockResolvedValueOnce(
        anthropicMsg(
          [
            {
              type: 'tool_use',
              id: 'tu-journey-plain',
              name: 'render_session_journey',
              input: { sessionId: 's1', errorId: 0 },
              caller: { type: 'direct' },
            } as Anthropic.ContentBlock,
          ],
          'tool_use',
        ),
      )
      .mockImplementationOnce((req: Anthropic.MessageCreateParamsNonStreaming) => {
        const last = req.messages.at(-1) as { content: Anthropic.ToolResultBlockParam[] };
        const block = last.content.find((b) => b.tool_use_id === 'tu-journey-plain');
        feedbackToModel = typeof block?.content === 'string' ? block.content : '';
        return Promise.resolve(
          anthropicMsg([{ type: 'text', text: 'done', citations: [] }], 'end_turn'),
        );
      });

    const adapter = new JourneyAdapter(); // has renderJourney, but must NOT be called
    const brain = new SdkBrain({
      createMessage: createMsg,
      callTool: (name, input) =>
        runtimeRef5.interceptCallTool(name, input, (n, i) => innerCallTool(n, i)),
      tools: [],
      model: 'm',
      extendedReasoning: false,
    });
    const store = new SessionStore(() => brain.newSession());
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const runtime5 = new ConnectorRuntime({ adapter, brain, mcp, store });
    runtimeRef5 = runtime5;
    await runtime5.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'journey' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'done']));

    // Plain text passed through unchanged.
    expect(feedbackToModel).toBe(plainText);
    // renderJourney was NOT called.
    expect(adapter.renderJourneyCalls).toHaveLength(0);
  });

  it('(f) no active conversationId at interception time → degrades to brief note, renderJourney NOT called, no throw', async () => {
    // When interceptCallTool is invoked outside a runLoop turn (no active
    // conversationId), a valid CausalChain JSON result must degrade gracefully:
    // return the brief note, never call renderJourney, never throw.
    const toolResult = JSON.stringify(CAUSAL_CHAIN_FIXTURE);

    const adapter = new JourneyAdapter('canvas-link');
    const store = new SessionStore(() => ({ history: [] }));
    const mcp = { callTool: vi.fn(), onElicit: () => {} } as unknown as PeekMcp;
    const brain: Brain = {
      newSession: (): Session => ({ history: [] }),
      appendUserText: () => {},
      appendToolResult: () => {},
      runTurn: async () => ({ kind: 'done' as const, text: 'ok' }),
    };
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    // Do NOT start the runtime or fire any message — #activeConversationId stays undefined.

    // Call interceptCallTool directly: no active turn means no conversationId.
    const result = await runtime.interceptCallTool(
      'render_session_journey',
      { sessionId: 's1', errorId: 42 },
      async () => toolResult,
    );

    // Should return the degrade note, not the raw JSON.
    expect(result).toContain('cannot render');
    expect(result).not.toContain('"timeline"');
    // renderJourney was NOT called.
    expect(adapter.renderJourneyCalls).toHaveLength(0);
  });
});
