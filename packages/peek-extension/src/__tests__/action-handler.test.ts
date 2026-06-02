import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addEnabledOrigin } from '../activation/storage';
import {
  type ActionHandlerDeps,
  type DispatchTarget,
  InMemoryConfirmTokenStore,
  type TabRef,
  handleActionRequest,
} from '../permissions/action-handler';
import type { ActionRequestMessage } from '../permissions/action-protocol';
import { setPermissionLevel } from '../permissions/store';
import { YoloSessionStore } from '../permissions/yolo';

// Vitest setup.ts already installs fakeBrowser. The action-handler reaches
// chrome.storage.sync via the activation/storage + permissions/store helpers,
// so we reset between tests for isolation.

beforeEach(() => fakeBrowser.reset());
afterEach(() => fakeBrowser.reset());

function makeRequest(overrides: Partial<ActionRequestMessage> = {}): ActionRequestMessage {
  return {
    type: 'action.request',
    requestId: 'req-1',
    tool: 'execute_action',
    sessionId: 's_test',
    action: { type: 'click', selector: '#a', button: 'left' },
    client: 'cursor',
    policy: { add: [], remove: [] },
    ...overrides,
  };
}

interface Spies {
  promptResult:
    | { verdict: 'allow' | 'deny'; approvalMs: number; alwaysForSite?: boolean }
    | { verdict: 'deny'; approvalMs: number; reason: 'timeout' | 'panel-closed' };
  target: DispatchTarget;
  dispatchOutcome: { ok: true; details?: unknown } | { ok: false; error: string };
}

function makeDeps(
  overrides: Partial<ActionHandlerDeps> = {},
  spies: Partial<Spies> = {},
): {
  deps: ActionHandlerDeps;
  tokens: InMemoryConfirmTokenStore;
  yolo: YoloSessionStore;
  promptCalls: number;
  dispatchCalls: number;
  resolveTargetCalls: number;
} {
  const tokens = new InMemoryConfirmTokenStore();
  const yolo = new YoloSessionStore();
  const state = {
    promptCalls: 0,
    dispatchCalls: 0,
    resolveTargetCalls: 0,
  };
  const target = spies.target ?? { text: 'Click me' };
  const promptResult = spies.promptResult ?? { verdict: 'allow' as const, approvalMs: 1000 };
  const dispatchOutcome = spies.dispatchOutcome ?? ({ ok: true } as const);

  const deps: ActionHandlerDeps = {
    async getTabFor() {
      return { id: 42, url: 'https://example.com/page', title: 'X', active: true };
    },
    yolo,
    tokens,
    async promptUserConfirmation() {
      state.promptCalls += 1;
      return promptResult;
    },
    async resolveTarget() {
      state.resolveTargetCalls += 1;
      return target;
    },
    async dispatchInMainWorld() {
      state.dispatchCalls += 1;
      return dispatchOutcome;
    },
    ...overrides,
  };
  return {
    deps,
    tokens,
    yolo,
    get promptCalls() {
      return state.promptCalls;
    },
    get dispatchCalls() {
      return state.dispatchCalls;
    },
    get resolveTargetCalls() {
      return state.resolveTargetCalls;
    },
  };
}

async function enableOriginAtLevel(origin: string, level: 0 | 1 | 2 | 3 | 4): Promise<void> {
  await addEnabledOrigin(origin);
  await setPermissionLevel(origin, level);
}

describe('handleActionRequest — Level 0 / 1 / 2 deny', () => {
  for (const level of [0, 1, 2] as const) {
    it(`Level ${level} denies with a not-authorized result`, async () => {
      await enableOriginAtLevel('https://example.com', level);
      const ctx = makeDeps();
      const out = await handleActionRequest(makeRequest(), ctx.deps);
      expect(out.verdict).toBe('deny');
      expect(out.result).toBe('denied');
      expect(out.error).toContain('not authorized');
      expect(ctx.promptCalls).toBe(0);
      expect(ctx.dispatchCalls).toBe(0);
    });
  }
});

describe('handleActionRequest — Level 3 act-with-confirm', () => {
  it('execute_action prompts the user; allow → dispatch + ok', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps({}, { promptResult: { verdict: 'allow', approvalMs: 1234 } });
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(out.approver).toBe('user');
    expect(out.approvalMs).toBe(1234);
    expect(ctx.promptCalls).toBe(1);
    expect(ctx.dispatchCalls).toBe(1);
  });

  it('execute_action: user denies → no dispatch', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps({}, { promptResult: { verdict: 'deny', approvalMs: 1 } });
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(out.result).toBe('denied');
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('request_authorization: allow → returns a one-shot confirmToken bound to (session, actionType)', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps();
    const out = await handleActionRequest(makeRequest({ tool: 'request_authorization' }), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.confirmToken).toBeTypeOf('string');
    // Token is bound to (sessionId, actionType=click) and consumable exactly once.
    const consumed = ctx.tokens.consume(out.confirmToken ?? '', 's_test', 'click');
    expect(consumed).not.toBeNull();
    const consumedAgain = ctx.tokens.consume(out.confirmToken ?? '', 's_test', 'click');
    expect(consumedAgain).toBeNull();
  });

  it('request_authorization: denied → no token issued', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps({}, { promptResult: { verdict: 'deny', approvalMs: 1 } });
    const out = await handleActionRequest(makeRequest({ tool: 'request_authorization' }), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(out.confirmToken).toBeUndefined();
    expect(ctx.tokens.size).toBe(0);
  });
});

describe('handleActionRequest — confirmToken consumption (Level 3)', () => {
  it('execute_action with a matching confirmToken skips the banner + dispatches', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps();
    // Pre-issue a token bound to (sessionId, actionType) on the shared store.
    const tok = ctx.tokens.issue('s_test', 'click');
    const out = await handleActionRequest(makeRequest({ confirmToken: tok.token }), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(out.approver).toBe('user');
    expect(ctx.promptCalls).toBe(0); // banner skipped
    expect(ctx.dispatchCalls).toBe(1);
    // One-shot: the token is now consumed.
    expect(ctx.tokens.consume(tok.token, 's_test', 'click')).toBeNull();
  });

  it('execute_action with a mismatched-actionType confirmToken falls through to the banner', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps({}, { promptResult: { verdict: 'allow', approvalMs: 7 } });
    // Token issued for a DIFFERENT action type — must not let us skip the banner.
    const tok = ctx.tokens.issue('s_test', 'type');
    const out = await handleActionRequest(makeRequest({ confirmToken: tok.token }), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(ctx.promptCalls).toBe(1); // banner DID run
    expect(ctx.dispatchCalls).toBe(1);
  });

  it('execute_action with an unknown confirmToken falls through to the banner', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps({}, { promptResult: { verdict: 'deny', approvalMs: 1 } });
    const out = await handleActionRequest(makeRequest({ confirmToken: 'never-issued' }), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(ctx.promptCalls).toBe(1); // banner ran; user denied
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('request_authorization ignores confirmToken (always prompts to issue a fresh token)', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps();
    const tok = ctx.tokens.issue('s_test', 'click');
    const out = await handleActionRequest(
      makeRequest({ tool: 'request_authorization', confirmToken: tok.token }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(out.confirmToken).toBeTypeOf('string');
    expect(ctx.promptCalls).toBe(1); // request_authorization always prompts
    expect(ctx.dispatchCalls).toBe(0);
  });
});

describe('handleActionRequest — Level 4 YOLO', () => {
  it('non-destructive action auto-allows (approver=level-4-auto, no prompt)', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(out.approver).toBe('level-4-auto');
    expect(ctx.promptCalls).toBe(0);
    expect(ctx.dispatchCalls).toBe(1);
  });

  it('destructive button text triggers a confirm prompt EVEN at Level 4', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps(
      {},
      { target: { text: 'Delete account' }, promptResult: { verdict: 'allow', approvalMs: 1 } },
    );
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.approver).toBe('user'); // prompted
    expect(out.destructiveTerm).toBe('delete');
    expect(ctx.promptCalls).toBe(1);
  });

  it('YOLO via in-memory yolo store: persistent level 1 + yolo active → effective 4 → allow', async () => {
    // Persistent level 1 (default), but YOLO is active for the origin: the
    // SW treats the effective level as 4. Used by the side panel "Switch to
    // YOLO this session" affordance.
    await addEnabledOrigin('https://example.com');
    const ctx = makeDeps();
    ctx.yolo.activate('https://example.com', 42, 1);
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.approver).toBe('level-4-auto');
  });

  it('user-extended destructive term (policy.add) also triggers confirm at Level 4', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps(
      {},
      { target: { text: 'Yeet the data' }, promptResult: { verdict: 'allow', approvalMs: 1 } },
    );
    const out = await handleActionRequest(
      makeRequest({ policy: { add: ['yeet'], remove: [] } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(out.destructiveTerm).toBe('yeet');
    expect(ctx.promptCalls).toBe(1);
  });
});

describe('handleActionRequest — pre-conditions', () => {
  it('denies when the origin is not enabled (recording was never authorized)', async () => {
    // No addEnabledOrigin call.
    const ctx = makeDeps();
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(out.result).toBe('denied');
    expect(out.error).toContain('not enabled');
  });

  it('denies when there is no active tab', async () => {
    const ctx = makeDeps({ getTabFor: async () => undefined });
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(out.error).toContain('no active tab');
  });

  it('denies when the active tab has no http(s) origin (e.g. chrome:// URL)', async () => {
    const ctx = makeDeps({
      getTabFor: async (): Promise<TabRef> => ({ id: 1, url: 'chrome://extensions' }),
    });
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(out.error).toContain('no http(s) origin');
  });
});

describe('handleActionRequest — dispatch failure surfaces as result=error', () => {
  it('a MAIN-world dispatch error becomes verdict=allow + result=error + error message', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps({}, { dispatchOutcome: { ok: false, error: 'selector not found' } });
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.verdict).toBe('allow'); // the gate allowed
    expect(out.result).toBe('error');
    expect(out.error).toBe('selector not found');
  });

  it('a thrown dispatcher promise becomes result=error', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps({
      async dispatchInMainWorld() {
        throw new Error('chrome.scripting unavailable');
      },
    });
    const out = await handleActionRequest(makeRequest(), ctx.deps);
    expect(out.result).toBe('error');
    expect(out.error).toContain('chrome.scripting unavailable');
  });
});

// --- Token bookkeeping (InMemoryConfirmTokenStore) -------------------------

describe('InMemoryConfirmTokenStore', () => {
  it('issues a token bound to (sessionId, actionType) consumable exactly once', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue('s_1', 'click');
    expect(store.consume(tok.token, 's_1', 'click')).not.toBeNull();
    expect(store.consume(tok.token, 's_1', 'click')).toBeNull();
  });

  it('rejects a token consumed against a DIFFERENT session', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue('s_1', 'click');
    expect(store.consume(tok.token, 's_OTHER', 'click')).toBeNull();
    // After a failed consume the token is GONE (one-shot semantics) to
    // prevent a malicious AI from retrying with the right args.
    expect(store.consume(tok.token, 's_1', 'click')).toBeNull();
  });

  it('rejects a token consumed against a different actionType', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue('s_1', 'click');
    expect(store.consume(tok.token, 's_1', 'type')).toBeNull();
  });

  it('rejects an expired token', () => {
    const fakeClock = { value: 0 };
    const store = new InMemoryConfirmTokenStore({
      generateToken: () => 'fixed-token',
      now: () => fakeClock.value,
    });
    store.issue('s_1', 'click');
    fakeClock.value = 60 * 60_000; // way past the 2-minute TTL
    expect(store.consume('fixed-token', 's_1', 'click', fakeClock.value)).toBeNull();
  });

  it('an unknown token returns null', () => {
    const store = new InMemoryConfirmTokenStore();
    expect(store.consume('never-issued', 's_1', 'click')).toBeNull();
  });
});
