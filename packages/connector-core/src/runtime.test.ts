import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentOutcome, Brain, Session } from './brain.js';
import type { PeekMcp } from './mcp.js';
import { ConnectorRuntime, classifyError } from './runtime.js';
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

/** Build a scripted consent brain that suspends on the named tool. */
function shareSessionBrain(toolName = 'share_session'): Brain {
  let toolResultSeen = false;
  return {
    newSession: (): Session => ({ history: [] }),
    appendUserText: () => {},
    appendToolResult: () => {
      toolResultSeen = true;
    },
    runTurn: async () =>
      toolResultSeen
        ? { kind: 'done', text: 'shared' }
        : {
            kind: 'consent',
            action: {
              toolUseId: 'tu-share-1',
              toolName,
              input: { sessionId: 's1', surface: 'slack' },
              createdAt: 0,
            },
          },
  };
}

describe('share_session interception — postFile + temp file delete', () => {
  it('calls adapter.postFile with the right args and deletes the temp file on approval', async () => {
    // Create a real temp file to assert deletion.
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

    const callTool = vi.fn().mockResolvedValue(toolResult);
    const adapter = new FileAdapter();
    const brain = shareSessionBrain();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool, onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share my session' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));

    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';
    adapter.consentHandler?.({ conversationId: 'c1', correlationId, decision: 'approve' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // postFile must have been called with the correct args.
    expect(adapter.postFileCalls).toHaveLength(1);
    expect(adapter.postFileCalls[0]?.conversationId).toBe('c1');
    expect(adapter.postFileCalls[0]?.filePath).toBe(bundlePath);
    expect(adapter.postFileCalls[0]?.filename).toBe('session.peekbundle');

    // The temp file must have been deleted.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();

    // Cleanup the temp dir (bundle already gone, just the dir remains).
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
    const callTool = vi.fn().mockResolvedValue(toolResult);

    class ThrowingFileAdapter extends FakeAdapter {
      async postFile(_c: string, _fp: string, _fn: string, _comment?: string): Promise<void> {
        throw new Error('Slack upload failed');
      }
    }

    const adapter = new ThrowingFileAdapter();
    const brain = shareSessionBrain();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool, onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));

    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';
    // The postFile throws but the runtime should swallow it into the error path
    // and the turn should still complete (error posted to brain, runLoop continues).
    adapter.consentHandler?.({ conversationId: 'c1', correlationId, decision: 'approve' });

    // Wait for the runtime to finish the turn (either postText or continuation).
    await vi.waitFor(() =>
      expect(adapter.texts.length + adapter.confirmations.length).toBeGreaterThan(0),
    );

    // The temp file must be deleted despite the upload failure.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('does not call postFile and does not throw when result is { ok: false }', async () => {
    const toolResult = JSON.stringify({ ok: false, result: 'denied', reason: 'user denied' });
    const callTool = vi.fn().mockResolvedValue(toolResult);
    const adapter = new FileAdapter();
    const brain = shareSessionBrain();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool, onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));

    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';
    adapter.consentHandler?.({ conversationId: 'c1', correlationId, decision: 'approve' });
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // No postFile should have been called.
    expect(adapter.postFileCalls).toHaveLength(0);
  });

  it('degrades to a text note (no crash) when adapter.postFile is undefined', async () => {
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
    const callTool = vi.fn().mockResolvedValue(toolResult);

    // FakeAdapter has no postFile method.
    const adapter = new FakeAdapter();
    const brain = shareSessionBrain();
    const store = new SessionStore(brain.newSession);
    const mcp = { callTool, onElicit: () => {} } as unknown as PeekMcp;
    const runtime = new ConnectorRuntime({ adapter, brain, mcp, store });
    await runtime.start();

    adapter.msgHandler?.({ conversationId: 'c1', userId: 'u', text: 'share' });
    await vi.waitFor(() => expect(adapter.consents).toHaveLength(1));

    const correlationId = adapter.consents[0]?.[1].correlationId ?? '';
    adapter.consentHandler?.({ conversationId: 'c1', correlationId, decision: 'approve' });

    // Should complete without crash.
    await vi.waitFor(() => expect(adapter.texts).toContainEqual(['c1', 'shared']));

    // Temp file should still be deleted.
    await expect(rm(bundlePath, { force: false })).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });
});
