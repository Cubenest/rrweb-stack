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
import type { Action, ActionRequestMessage } from '../permissions/action-protocol';
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

  it('request_authorization: allow → returns a one-shot confirmToken bound to the exact action', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps();
    // makeRequest's default action is click #a.
    const out = await handleActionRequest(makeRequest({ tool: 'request_authorization' }), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.confirmToken).toBeTypeOf('string');
    // Token is bound to the EXACT action (click #a) and consumable exactly once.
    const clickA: Action = { type: 'click', selector: '#a', button: 'left' };
    const consumed = ctx.tokens.consume(out.confirmToken ?? '', clickA);
    expect(consumed).not.toBeNull();
    const consumedAgain = ctx.tokens.consume(out.confirmToken ?? '', clickA);
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
    // Pre-issue a token bound to the EXACT action (click #a) on the shared store.
    const clickA: Action = { type: 'click', selector: '#a', button: 'left' };
    const tok = ctx.tokens.issue(clickA);
    const out = await handleActionRequest(makeRequest({ confirmToken: tok.token }), ctx.deps);
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(out.approver).toBe('user');
    expect(ctx.promptCalls).toBe(0); // banner skipped
    expect(ctx.dispatchCalls).toBe(1);
    // One-shot: the token is now consumed.
    expect(ctx.tokens.consume(tok.token, clickA)).toBeNull();
  });

  it('EXPLOIT GUARD: a token for click #newsletter-ok is rejected for click #delete-account', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    // The user only ever approved #newsletter-ok; the AI tries to spend that
    // token on #delete-account. The fingerprint mismatch must force a banner —
    // not silently dispatch the delete.
    const ctx = makeDeps({}, { promptResult: { verdict: 'deny', approvalMs: 1 } });
    const tok = ctx.tokens.issue({ type: 'click', selector: '#newsletter-ok', button: 'left' });
    const out = await handleActionRequest(
      makeRequest({
        action: { type: 'click', selector: '#delete-account', button: 'left' },
        confirmToken: tok.token,
      }),
      ctx.deps,
    );
    expect(ctx.promptCalls).toBe(1); // banner forced (token didn't match)
    expect(out.verdict).toBe('deny'); // user denied at the forced banner
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('EXPLOIT GUARD: destructive target on the token-consume path FORCES a fresh banner', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    // A token whose fingerprint matches the action, BUT the resolved DOM target
    // is destructive. The token must NOT auto-dispatch — re-run the destructive
    // matcher and force a fresh confirm banner.
    const ctx = makeDeps(
      {},
      { target: { text: 'Delete account' }, promptResult: { verdict: 'deny', approvalMs: 1 } },
    );
    const deleteClick: Action = { type: 'click', selector: '#a', button: 'left' };
    const tok = ctx.tokens.issue(deleteClick);
    const out = await handleActionRequest(makeRequest({ confirmToken: tok.token }), ctx.deps);
    expect(ctx.promptCalls).toBe(1); // banner forced despite a matching token
    expect(ctx.dispatchCalls).toBe(0); // user denied at the forced banner
    expect(out.destructiveTerm).toBe('delete');
  });

  it('execute_action with a mismatched-actionType confirmToken falls through to the banner', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps({}, { promptResult: { verdict: 'allow', approvalMs: 7 } });
    // Token issued for a DIFFERENT action type — must not let us skip the banner.
    const tok = ctx.tokens.issue({ type: 'type', selector: '#a', text: 'x', delay: 40 });
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
    const tok = ctx.tokens.issue({ type: 'click', selector: '#a', button: 'left' });
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

describe('handleActionRequest — TOCTOU re-validation at dispatch time', () => {
  it('EXPLOIT GUARD: tab navigates to a different origin during the confirm wait → denied, no dispatch', async () => {
    // The banner is shown for trusted.example. While the user decides, the tab
    // navigates to attacker.example. On Allow the dispatch must NOT fire into
    // the new origin.
    await enableOriginAtLevel('https://trusted.example', 3);
    let call = 0;
    const ctx = makeDeps(
      {
        getTabFor: async (): Promise<TabRef> => {
          call += 1;
          // First lookup (gate time): trusted.example. Subsequent lookups
          // (dispatch-time re-validation): attacker.example (the nav happened
          // during the up-to-2-min confirm wait).
          return call === 1
            ? { id: 42, url: 'https://trusted.example/page', active: true }
            : { id: 42, url: 'https://attacker.example/evil', active: true };
        },
      },
      { promptResult: { verdict: 'allow', approvalMs: 5 } },
    );
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#go', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(out.result).not.toBe('ok');
    expect(ctx.dispatchCalls).toBe(0); // never injected into attacker.example
    expect(String(out.error)).toMatch(/origin|changed|navigat/i);
  });

  it('EXPLOIT GUARD: origin-equality branch alone denies when the attacker origin is ALSO enabled at L3', async () => {
    // Isolation test for the `currentOrigin !== guarded.origin` branch. The
    // attacker origin is ALSO enabled at Level 3, so the isOriginEnabled guard
    // and the level-floor guard BOTH pass on the dispatch-time re-check — only
    // the origin-equality comparison can deny. (The sibling test above lets
    // isOriginEnabled catch the attacker origin, so it never reaches this
    // branch; this one does.)
    await enableOriginAtLevel('https://trusted.example', 3);
    await enableOriginAtLevel('https://attacker.example', 3);
    let call = 0;
    const ctx = makeDeps(
      {
        getTabFor: async (): Promise<TabRef> => {
          call += 1;
          // Gate time: trusted.example. Dispatch-time re-validation:
          // attacker.example — which is fully enabled at L3, so the only thing
          // standing between the AI and a cross-origin dispatch is the
          // origin-equality check.
          return call === 1
            ? { id: 42, url: 'https://trusted.example/page', active: true }
            : { id: 42, url: 'https://attacker.example/evil', active: true };
        },
      },
      { promptResult: { verdict: 'allow', approvalMs: 5 } },
    );
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#go', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(out.result).not.toBe('ok');
    expect(ctx.dispatchCalls).toBe(0); // never injected into attacker.example
    expect(String(out.error)).toMatch(/origin changed/i);
  });

  it('EXPLOIT GUARD: dispatch-time level-drop branch denies (origin unchanged + still enabled)', async () => {
    // Isolation test for the `currentLevel < MIN_ACT_LEVEL` re-check. The origin
    // is unchanged and stays enabled through the wait, so neither the
    // origin-equality nor the isOriginEnabled guard fires — only the level-floor
    // re-check can deny. The user downgrades trusted.example from L3 → L1 while
    // the banner is up (then clicks Allow).
    await enableOriginAtLevel('https://trusted.example', 3);
    const ctx = makeDeps(
      {
        getTabFor: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://trusted.example/page',
          active: true,
        }),
      },
      { promptResult: { verdict: 'allow', approvalMs: 5 } },
    );
    const realPrompt = ctx.deps.promptUserConfirmation;
    ctx.deps.promptUserConfirmation = async (input) => {
      // Drop the level mid-confirm — origin stays enabled, just no longer
      // act-authorized (L1 < MIN_ACT_LEVEL=3).
      const { setPermissionLevel } = await import('../permissions/store');
      await setPermissionLevel('https://trusted.example', 1);
      return realPrompt(input);
    };
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#go', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(ctx.dispatchCalls).toBe(0);
    expect(String(out.error)).toMatch(/level dropped/i);
  });

  it('EXPLOIT GUARD: origin disabled during the confirm wait → denied, no dispatch', async () => {
    await enableOriginAtLevel('https://trusted.example', 3);
    const ctx = makeDeps(
      {
        getTabFor: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://trusted.example/page',
          active: true,
        }),
      },
      { promptResult: { verdict: 'allow', approvalMs: 5 } },
    );
    // Simulate the user disabling the site WHILE the confirm banner is up: the
    // prompt callback removes the enabled origin, so the dispatch-time
    // re-validation must find it no longer enabled and deny.
    const realPrompt = ctx.deps.promptUserConfirmation;
    ctx.deps.promptUserConfirmation = async (input) => {
      const { removeEnabledOrigin } = await import('../activation/storage');
      await removeEnabledOrigin('https://trusted.example');
      return realPrompt(input);
    };
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#go', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('allows when the origin is unchanged through the confirm wait', async () => {
    await enableOriginAtLevel('https://trusted.example', 3);
    const ctx = makeDeps(
      {
        getTabFor: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://trusted.example/page',
          active: true,
        }),
      },
      { promptResult: { verdict: 'allow', approvalMs: 5 } },
    );
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#go', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(ctx.dispatchCalls).toBe(1);
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

const CLICK_OK: Action = { type: 'click', selector: '#newsletter-ok', button: 'left' };
const CLICK_DELETE: Action = { type: 'click', selector: '#delete-account', button: 'left' };

describe('InMemoryConfirmTokenStore', () => {
  it('issues a token bound to the EXACT action fingerprint, consumable exactly once', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue(CLICK_OK);
    expect(store.consume(tok.token, CLICK_OK)).not.toBeNull();
    expect(store.consume(tok.token, CLICK_OK)).toBeNull();
  });

  it('EXPLOIT GUARD: rejects a token presented with a different selector (same actionType)', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue(CLICK_OK);
    // The classic exploit: approve click #newsletter-ok, reuse for #delete-account.
    expect(store.consume(tok.token, CLICK_DELETE)).toBeNull();
    // After a failed consume the token is GONE (one-shot) so a malicious AI
    // can't retry with the right args.
    expect(store.consume(tok.token, CLICK_OK)).toBeNull();
  });

  it('rejects a token consumed against a different actionType', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue(CLICK_OK);
    expect(
      store.consume(tok.token, { type: 'type', selector: '#newsletter-ok', text: 'x', delay: 40 }),
    ).toBeNull();
  });

  it('rejects a token consumed against a different nth match', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue({ type: 'click', selector: '.row', nth: 0, button: 'left' });
    expect(
      store.consume(tok.token, { type: 'click', selector: '.row', nth: 3, button: 'left' }),
    ).toBeNull();
  });

  it('rejects a navigate token presented with a different URL', () => {
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue({ type: 'navigate', url: 'https://trusted.example/ok' });
    expect(
      store.consume(tok.token, { type: 'navigate', url: 'https://attacker.example/' }),
    ).toBeNull();
  });

  it('rejects an expired token', () => {
    const fakeClock = { value: 0 };
    const store = new InMemoryConfirmTokenStore({
      generateToken: () => 'fixed-token',
      now: () => fakeClock.value,
    });
    store.issue(CLICK_OK);
    fakeClock.value = 60 * 60_000; // way past the 2-minute TTL
    expect(store.consume('fixed-token', CLICK_OK, fakeClock.value)).toBeNull();
  });

  it('an unknown token returns null', () => {
    const store = new InMemoryConfirmTokenStore();
    expect(store.consume('never-issued', CLICK_OK)).toBeNull();
  });
});
