import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureScreenshot, isReadOnlyAction } from '../../entrypoints/background';
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
    | { verdict: 'deny'; approvalMs: number; reason: 'timeout' | 'user-deny' | 'panel-closed' };
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
    // Placeholder; replaced below so it tracks the FINAL (possibly-overridden)
    // getTabFor. Tests that exercise a mid-confirm navigation override getTabById.
    async getTabById() {
      return undefined;
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
  // Default getTabById: re-fetch by id returns the SAME tab getTabFor resolves
  // (the no-navigation case). Applied AFTER overrides so a test that overrides
  // only getTabFor still has a consistent re-validation tab; tests that need a
  // mid-confirm navigation override getTabById explicitly.
  if (overrides.getTabById === undefined) {
    deps.getTabById = async () => deps.getTabFor(makeRequest());
  }
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

describe('handleActionRequest — highlight (Suggest tier, Level 2+)', () => {
  it('highlight at Level 2 → allow + dispatches once (no prompt)', async () => {
    await enableOriginAtLevel('https://example.com', 2);
    const ctx = makeDeps();
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'highlight', selector: '#x', label: 'hi' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(out.approver).toBe('level-2-suggest');
    expect(ctx.promptCalls).toBe(0);
    expect(ctx.dispatchCalls).toBe(1);
  });

  it('highlight at Level 1 → deny (level-too-low-for-highlight), no dispatch', async () => {
    await enableOriginAtLevel('https://example.com', 1);
    const ctx = makeDeps();
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'highlight', selector: '#x' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(out.result).toBe('denied');
    expect(String(out.error)).toContain('level-too-low-for-highlight');
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('clear_highlight at Level 2 → allow', async () => {
    await enableOriginAtLevel('https://example.com', 2);
    const ctx = makeDeps();
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'clear_highlight' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(ctx.dispatchCalls).toBe(1);
  });

  it('highlight on a NON-enabled origin → deny (origin guard fires before the highlight branch)', async () => {
    // Do NOT enable the origin — proves the isOriginEnabled guard (which
    // precedes the highlight branch) still denies highlights on unactivated sites.
    const ctx = makeDeps();
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'highlight', selector: '#x' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(String(out.error)).toContain('not enabled');
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('highlight at Level 4 (YOLO) → allow (>=2 admits L4, still level-2-suggest approver)', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'highlight', selector: '#x' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(out.result).toBe('ok');
    expect(out.approver).toBe('level-2-suggest');
    expect(ctx.dispatchCalls).toBe(1);
  });
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
    const ctx = makeDeps(
      {
        // Gate time: the captured tab is on trusted.example.
        getTabFor: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://trusted.example/page',
          active: true,
        }),
        // Dispatch-time re-validation re-fetches the CAPTURED tab by id; by then
        // it navigated to attacker.example during the up-to-2-min confirm wait.
        getTabById: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://attacker.example/evil',
          active: true,
        }),
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
    const ctx = makeDeps(
      {
        // Gate time: trusted.example.
        getTabFor: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://trusted.example/page',
          active: true,
        }),
        // Dispatch-time re-validation (re-fetch the captured tab by id):
        // attacker.example — which is fully enabled at L3, so the only thing
        // standing between the AI and a cross-origin dispatch is the
        // origin-equality check.
        getTabById: async (): Promise<TabRef> => ({
          id: 42,
          url: 'https://attacker.example/evil',
          active: true,
        }),
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

  it('EXPLOIT GUARD (item A): re-validation re-fetches the CAPTURED tab id, not a freshly-resolved active tab', async () => {
    // The active-tab-resolution exploit: the request has no tabId, so the gate
    // resolves the active tab (tab A on trusted.example). During the confirm
    // wait the user switches focus so the active tab is now tab B
    // (also trusted.example, so origin-equality + level + enabled all PASS for
    // B) — but tab A has navigated cross-origin to attacker.example. If the
    // re-validation re-resolves the ACTIVE tab it sees B (passes) yet the
    // dispatch hits A's id → cross-origin write. The fix re-fetches the CAPTURED
    // tab id (A), sees attacker.example, and denies.
    await enableOriginAtLevel('https://trusted.example', 3);
    const getTabFor = async (): Promise<TabRef> => {
      // Active-tab resolution: at gate time AND any later active-tab query this
      // returns tab A (id 1) on trusted.example. (If the buggy code re-resolves
      // the active tab here it would also see trusted.example and pass.)
      return { id: 1, url: 'https://trusted.example/page', active: true };
    };
    const getTabById = async (tabId: number): Promise<TabRef | undefined> => {
      // Re-fetching the CAPTURED tab id (1) reflects its CURRENT url: it
      // navigated cross-origin to attacker.example during the confirm wait.
      if (tabId === 1) return { id: 1, url: 'https://attacker.example/evil', active: false };
      return undefined;
    };
    const ctx = makeDeps(
      { getTabFor, getTabById },
      { promptResult: { verdict: 'allow', approvalMs: 5 } },
    );
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#go', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('deny');
    expect(out.result).not.toBe('ok');
    expect(ctx.dispatchCalls).toBe(0); // never injected into the navigated tab
    expect(String(out.error)).toMatch(/origin changed/i);
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

describe('handleActionRequest — resolveTarget receives the full action (item B, nth)', () => {
  it('EXPLOIT GUARD: a destructive element at nth>0 is resolved + classified destructive → confirm', async () => {
    // The destructive matcher + banner context must resolve the element the
    // click ACTUALLY hits (nth=1), not the benign first match. At Level 4 a
    // non-destructive action auto-allows; a destructive one must force confirm.
    // We model the page: resolveTarget returns "Delete account" ONLY when the
    // action's nth is 1 (the element the dispatcher will click); nth 0/undefined
    // returns the benign first match.
    await enableOriginAtLevel('https://example.com', 4);
    let seenAction: Action | undefined;
    const ctx = makeDeps(
      {
        async resolveTarget({ action }) {
          seenAction = action;
          const nth = 'nth' in action ? action.nth : undefined;
          return nth === 1 ? { text: 'Delete account' } : { text: 'Save changes' };
        },
      },
      { promptResult: { verdict: 'deny', approvalMs: 1 } },
    );
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '.row', nth: 1, button: 'left' } }),
      ctx.deps,
    );
    // The handler forwarded the FULL action (incl. nth) to resolveTarget.
    expect(seenAction).toMatchObject({ type: 'click', selector: '.row', nth: 1 });
    // The nth=1 element is destructive → confirm forced even at Level 4.
    expect(ctx.promptCalls).toBe(1);
    expect(out.destructiveTerm).toBe('delete');
    expect(ctx.dispatchCalls).toBe(0); // user denied at the forced banner
  });
});

describe('handleActionRequest — Plan A label hook + shield enter-guard', () => {
  it('fires onActionLabel after resolveTarget for a click', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const labels: Array<{ tabId: number; label: string }> = [];
    const ctx = makeDeps({}, { target: { text: 'Apply now' } });
    ctx.deps.onActionLabel = (tabId, label) => labels.push({ tabId, label });
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'click', selector: '#apply', button: 'left' } }),
      ctx.deps,
    );
    expect(out.verdict).toBe('allow');
    expect(labels.length).toBe(1);
    expect(labels[0]?.tabId).toBe(42);
    expect(labels[0]?.label).toContain('Clicking');
  });

  it('rejects a selector-less enter while the shield is active', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    const out = await handleActionRequest(makeRequest({ action: { type: 'enter' } }), ctx.deps);
    expect(out.verdict).toBe('deny');
    expect(String(out.error)).toContain('explicit selector');
    expect(ctx.dispatchCalls).toBe(0);
  });

  it('allows a selector-bearing enter while the shield is active', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    const out = await handleActionRequest(
      makeRequest({ action: { type: 'enter', selector: '#search' } }),
      ctx.deps,
    );
    expect(out.verdict).not.toBe('deny'); // proceeds to dispatch
  });

  it('rejects a selector-less enter when isShieldActive flips true during handoff', async () => {
    // Task 8 wires isShieldActive to (isUp || isHandoff); the enter-guard must
    // also fire during a handoff. Simulate the controller flipping true.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    let inHandoff = false;
    ctx.deps.isShieldActive = () => inHandoff;
    // Shield down: selector-less enter proceeds.
    const before = await handleActionRequest(makeRequest({ action: { type: 'enter' } }), ctx.deps);
    expect(before.verdict).not.toBe('deny');
    // Handoff begins → shield active → selector-less enter denied.
    inHandoff = true;
    const during = await handleActionRequest(makeRequest({ action: { type: 'enter' } }), ctx.deps);
    expect(during.verdict).toBe('deny');
    expect(String(during.error)).toContain('explicit selector');
  });
});

describe('handleActionRequest — request_user_input handoff (Plan B)', () => {
  it('request_user_input below Level 4 → denied (stopped)', async () => {
    await enableOriginAtLevel('https://example.com', 3);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true; // shield up, but level too low
    const res = await handleActionRequest(
      makeRequest({ action: { type: 'request_user_input', prompt: 'x' } }),
      ctx.deps,
    );
    expect(res.verdict).toBe('deny');
  });

  it('request_user_input at Level 4 but shield down → denied', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => false;
    const res = await handleActionRequest(
      makeRequest({ action: { type: 'request_user_input', prompt: 'x' } }),
      ctx.deps,
    );
    expect(res.verdict).toBe('deny');
  });

  it('request_user_input with a destructive button selector → ineligible', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: false,
      tagName: 'BUTTON',
      inputType: null,
      autocomplete: null,
      destructiveSignals: { text: 'Delete' },
      isConnected: true,
    });
    const res = await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#del' },
        policy: { add: ['delete'], remove: [] },
      }),
      ctx.deps,
    );
    expect(res.verdict).toBe('allow');
    expect(res.result).toBe('ok'); // returns allow+ok with details.ineligible
    expect((res.details as { reason?: string }).reason).toBe('ineligible');
  });

  it('request_user_input on an EDITABLE field with a destructive label → ineligible', async () => {
    // Isolates the `destructive.matched` override: the field IS editable (so the
    // `!elig.editable` clause does NOT short-circuit), but its label contains a
    // base destructive term (`delete`), so the destructive override alone must
    // make it ineligible and enterHandoff must NOT be called.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: null,
      destructiveSignals: { text: 'Delete account' },
      isConnected: true,
    });
    let handoffCalls = 0;
    ctx.deps.enterHandoff = async () => {
      handoffCalls += 1;
      return { resumed: true };
    };
    const res = await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#confirm' },
      }),
      ctx.deps,
    );
    expect(res.verdict).toBe('allow');
    expect(res.result).toBe('ok');
    expect((res.details as { reason?: string }).reason).toBe('ineligible');
    expect(handoffCalls).toBe(0); // destructive override beats an otherwise-eligible target
  });

  it('request_user_input with an editable field → calls enterHandoff, returns its details', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: null,
      destructiveSignals: {},
      isConnected: true,
    });
    ctx.deps.enterHandoff = async () => ({ resumed: true, value: 'hi' });
    const res = await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#f', readBack: true },
      }),
      ctx.deps,
    );
    expect(res.approver).toBe('user');
    expect(res.details).toMatchObject({ resumed: true, value: 'hi' });
  });

  it('non-sensitive editable field with readBack → readBack survives as true', async () => {
    // Mirror image of the password/OTP/cc tests: a plain text input must NOT
    // have readBack forced off — a regression that always disables readBack
    // would be caught here.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'TEXTAREA',
      inputType: null,
      autocomplete: null,
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#notes', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(true); // non-sensitive ⇒ readBack honored
  });

  it('handoff timeoutMs above the bridge ceiling is clamped before enterHandoff', async () => {
    // The MCP schema permits timeoutMs up to 600000, but the host-bridge default
    // (5 min) cuts the request off first. The handler must clamp to 240000 (the
    // same ceiling waitFor uses) so the SW timer settles the handoff in time.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: null,
      destructiveSignals: {},
      isConnected: true,
    });
    let calledTimeout: number | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledTimeout = i.timeoutMs;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#f', timeoutMs: 600000 },
      }),
      ctx.deps,
    );
    expect(calledTimeout).toBe(240000); // clamped under the 5-min bridge timeout
  });

  it('handoff timeoutMs under the ceiling is forwarded unchanged', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: null,
      destructiveSignals: {},
      isConnected: true,
    });
    let calledTimeout: number | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledTimeout = i.timeoutMs;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#f', timeoutMs: 90000 },
      }),
      ctx.deps,
    );
    expect(calledTimeout).toBe(90000); // below the ceiling ⇒ unchanged
  });

  it('password field with readBack → handoff proceeds but readBack is forced off', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'password',
      autocomplete: null,
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#pw', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(false); // password ⇒ never read back
  });

  it('OTP field (autocomplete one-time-code) with readBack → forced off', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: 'one-time-code',
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#otp', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(false);
  });

  it('credit-card field (autocomplete cc-*) with readBack → forced off', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: 'cc-number',
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#cc', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(false);
  });

  it('multi-token OTP autocomplete (one-time-code webauthn) with readBack → forced off', async () => {
    // The HTML autocomplete attr is space-separated: a real OTP field can be
    // `one-time-code webauthn`. An exact-match check would miss it and leak.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: 'one-time-code webauthn',
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#otp', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(false);
  });

  it('multi-token cc autocomplete (shipping cc-number) with readBack → forced off', async () => {
    // The autocomplete attr can carry a section/detail token before cc-*:
    // `shipping cc-number`. A whole-string prefix check would miss it.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: 'shipping cc-number',
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#cc', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(false);
  });

  it('mixed-case cc autocomplete (CC-Number) with readBack → forced off', async () => {
    // The autocomplete attr is case-insensitive: `CC-Number` must be masked.
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => ({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      autocomplete: 'CC-Number',
      destructiveSignals: {},
      isConnected: true,
    });
    let calledReadBack: boolean | undefined;
    ctx.deps.enterHandoff = async (i) => {
      calledReadBack = i.readBack;
      return { resumed: true };
    };
    await handleActionRequest(
      makeRequest({
        action: { type: 'request_user_input', prompt: 'x', selector: '#cc', readBack: true },
      }),
      ctx.deps,
    );
    expect(calledReadBack).toBe(false);
  });

  it('selector-less (free-text prompt) → skips eligibility, calls enterHandoff', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    let eligibilityCalls = 0;
    ctx.deps.resolveHandoffEligibility = async () => {
      eligibilityCalls += 1;
      return {
        editable: false,
        tagName: null,
        inputType: null,
        autocomplete: null,
        destructiveSignals: {},
        isConnected: false,
      };
    };
    let handoffPrompt: string | undefined;
    let handoffSelector: string | undefined;
    ctx.deps.enterHandoff = async (i) => {
      handoffPrompt = i.prompt;
      handoffSelector = i.selector;
      return { resumed: true };
    };
    const res = await handleActionRequest(
      makeRequest({ action: { type: 'request_user_input', prompt: 'Solve the captcha' } }),
      ctx.deps,
    );
    expect(eligibilityCalls).toBe(0); // no selector → no MAIN-world probe
    expect(handoffPrompt).toBe('Solve the captcha');
    expect(handoffSelector).toBeUndefined();
    expect(res.verdict).toBe('allow');
    expect(res.details).toMatchObject({ resumed: true });
  });

  it('selector resolves to a disconnected/missing element (no eligibility) → ineligible', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    ctx.deps.resolveHandoffEligibility = async () => undefined as never;
    let handoffCalls = 0;
    ctx.deps.enterHandoff = async () => {
      handoffCalls += 1;
      return { resumed: true };
    };
    const res = await handleActionRequest(
      makeRequest({ action: { type: 'request_user_input', prompt: 'x', selector: '#gone' } }),
      ctx.deps,
    );
    expect((res.details as { reason?: string }).reason).toBe('ineligible');
    expect(handoffCalls).toBe(0);
  });

  it('enterHandoff missing/returns nothing → details {resumed:false, stopped}', async () => {
    await enableOriginAtLevel('https://example.com', 4);
    const ctx = makeDeps();
    ctx.deps.isShieldActive = () => true;
    // enterHandoff is undefined (not wired).
    const res = await handleActionRequest(
      makeRequest({ action: { type: 'request_user_input', prompt: 'x' } }),
      ctx.deps,
    );
    expect(res.verdict).toBe('allow');
    expect(res.details).toMatchObject({ resumed: false, reason: 'stopped' });
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

// --- SW-level screenshot capture + read-only bypass (Lane 2) ----------------
// `captureScreenshot` and `isReadOnlyAction` are module-scope SW helpers in
// entrypoints/background.ts (importing the module does NOT run `main()` — wxt's
// defineBackground only stores the config; the SW invokes main() at runtime).

/**
 * Install a fake `chrome.tabs` surface for the screenshot helper (active-tab
 * guard only — get + query). Returns a restore() to put the originals back.
 */
function stubTabs(fake: {
  get: (id: number) => Promise<{ windowId?: number }>;
  query: (q: { active: boolean; windowId: number }) => Promise<Array<{ id?: number }>>;
}): () => void {
  const tabs = (globalThis as unknown as { chrome: { tabs: Record<string, unknown> } }).chrome.tabs;
  const saved = { get: tabs.get, query: tabs.query };
  tabs.get = fake.get as unknown as typeof tabs.get;
  tabs.query = fake.query as unknown as typeof tabs.query;
  return () => {
    tabs.get = saved.get;
    tabs.query = saved.query;
  };
}

/**
 * Install a fake `chrome.debugger` surface for the CDP screenshot path.
 * `chrome.debugger` is absent from fakeBrowser, so we set it directly on
 * globalThis.chrome. Returns a restore() to put the original back.
 */
function stubDebugger(fake: {
  attach?: (target: { tabId: number }, version: string) => Promise<void>;
  sendCommand?: (target: { tabId: number }, method: string, params?: unknown) => Promise<unknown>;
  detach?: (target: { tabId: number }) => Promise<void>;
}): () => void {
  const root = globalThis as unknown as { chrome: Record<string, unknown> };
  const hadProp = Object.prototype.hasOwnProperty.call(root.chrome, 'debugger');
  const saved = root.chrome.debugger;
  root.chrome.debugger = {
    attach: fake.attach ?? (async () => {}),
    sendCommand: fake.sendCommand ?? (async () => ({ data: 'AAAA' })),
    detach: fake.detach ?? (async () => {}),
  };
  return () => {
    // If `chrome.debugger` didn't exist originally (fakeBrowser doesn't include
    // it), delete the property rather than setting it to undefined — fakeBrowser
    // iterates its own entries in reset() and throws on undefined values.
    if (!hadProp) {
      // Setting to undefined puts `undefined` into fakeBrowser's property bag and crashes
      // fakeBrowser.reset() (it iterates entries + calls .resetState() on each value).
      // biome-ignore lint/performance/noDelete: must delete, not assign undefined — see comment above
      delete root.chrome.debugger;
    } else {
      root.chrome.debugger = saved;
    }
  };
}

describe('captureScreenshot — mandatory active-tab guard (Lane 2)', () => {
  it('active-tab MISMATCH → { ok:false } and does NOT call chrome.debugger', async () => {
    let attached = 0;
    const restoreTabs = stubTabs({
      get: async () => ({ windowId: 7 }),
      // The active tab in window 7 is a DIFFERENT tab (id 99) than the target (42).
      query: async () => [{ id: 99 }],
    });
    const restoreDbg = stubDebugger({
      attach: async () => {
        attached += 1;
      },
    });
    try {
      const out = await captureScreenshot(42, { type: 'screenshot' });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error).toMatch(/active/i);
      expect(attached).toBe(0); // guard fires before CDP is touched
    } finally {
      restoreTabs();
      restoreDbg();
    }
  });

  it('active-tab MATCH → { ok:true } with details.dataUrl + selectorCropped:false', async () => {
    const restoreTabs = stubTabs({
      get: async () => ({ windowId: 7 }),
      query: async () => [{ id: 42 }], // active tab IS the target
    });
    const restoreDbg = stubDebugger({
      attach: async (target, version) => {
        expect(target.tabId).toBe(42);
        expect(version).toBe('1.3');
      },
      sendCommand: async (_target, method, params) => {
        expect(method).toBe('Page.captureScreenshot');
        expect((params as Record<string, unknown>).format).toBe('png');
        return { data: 'AAAA' };
      },
      detach: async (target) => {
        expect(target.tabId).toBe(42);
      },
    });
    try {
      // selector is accepted but IGNORED in v1.
      const out = await captureScreenshot(42, { type: 'screenshot', selector: '#delete-account' });
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.details).toEqual({
          dataUrl: 'data:image/png;base64,AAAA',
          format: 'png',
          selectorCropped: false,
        });
      }
    } finally {
      restoreTabs();
      restoreDbg();
    }
  });
});

describe('isReadOnlyAction — resolveTarget read-only bypass (Lane 2)', () => {
  it('returns true for waitFor and screenshot (the verbs resolveTarget short-circuits)', () => {
    expect(isReadOnlyAction({ type: 'waitFor', selector: '#x', timeoutMs: 1000 })).toBe(true);
    expect(isReadOnlyAction({ type: 'screenshot' })).toBe(true);
    expect(isReadOnlyAction({ type: 'screenshot', selector: '#delete-account' })).toBe(true);
  });

  it('returns false for element-operating verbs (click/type/scroll/navigate)', () => {
    expect(isReadOnlyAction({ type: 'click', selector: '#x', button: 'left' })).toBe(false);
    expect(isReadOnlyAction({ type: 'type', selector: '#x', text: 'a', delay: 40 })).toBe(false);
    expect(isReadOnlyAction({ type: 'scroll', selector: '#x' })).toBe(false);
    expect(isReadOnlyAction({ type: 'navigate', url: 'https://example.com' })).toBe(false);
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

  it('EXPLOIT GUARD (item B): a type token for "100" is rejected for "999999" (text is bound)', () => {
    // The user approved `type #amount "100"`; the AI tries to spend that token
    // on `type #amount "999999"`. The fingerprint MUST bind the typed text
    // (via a stable hash) so the larger amount is rejected.
    const store = new InMemoryConfirmTokenStore();
    const tok = store.issue({ type: 'type', selector: '#amount', text: '100', delay: 40 });
    expect(
      store.consume(tok.token, { type: 'type', selector: '#amount', text: '999999', delay: 40 }),
    ).toBeNull();
    // Same text → still consumable (issue a fresh token, the prior is gone).
    const tok2 = store.issue({ type: 'type', selector: '#amount', text: '100', delay: 40 });
    expect(
      store.consume(tok2.token, { type: 'type', selector: '#amount', text: '100', delay: 99 }),
    ).not.toBeNull(); // delay is cosmetic; only selector+text bind
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
