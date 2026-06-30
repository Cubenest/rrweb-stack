import { describe, expect, it } from 'vitest';
import { ShieldController, type ShieldControllerDeps } from '../shield/controller';
import type { ViewCommand } from '../shield/protocol';

function harness(opts: { connected?: boolean; level?: number } = {}) {
  const commands: Array<{ tabId: number; cmd: ViewCommand }> = [];
  const dropped: string[] = [];
  let connected = opts.connected ?? true;
  let level = opts.level ?? 4;
  // Controllable fake timers: setTimer returns the slot index; fireTimer(i)
  // runs the stored callback synchronously; clearTimer nulls the slot.
  const timers: Array<{ fn: () => void; ms: number } | undefined> = [];
  const deps: ShieldControllerDeps = {
    commandView: (tabId, cmd) => commands.push({ tabId, cmd }),
    dropToSafeLevel: async (origin) => {
      dropped.push(origin);
    },
    isHostConnected: () => connected,
    getEffectiveLevel: async () => level,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: (h) => {
      if (typeof h === 'number') timers[h] = undefined;
    },
  };
  const c = new ShieldController(deps);
  return {
    c,
    commands,
    dropped,
    setConnected: (v: boolean) => {
      connected = v;
    },
    setLevel: (v: number) => {
      level = v;
    },
    fireTimer: (i = timers.length - 1) => timers[i]?.fn(),
  };
}

describe('ShieldController', () => {
  it('RAISEs when level>=4 and host connected', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    expect(h.commands.map((x) => x.cmd.kind)).toEqual(['RAISE']);
    expect(h.commands[0]?.tabId).toBe(1);
  });

  it('does NOT raise when host disconnected', () => {
    const h = harness({ connected: false });
    h.c.onLevelChanged(1, 'https://a.test', 4);
    expect(h.commands).toEqual([]);
  });

  it('LOWERs on level drop below 4', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onLevelChanged(1, 'https://a.test', 1);
    expect(h.commands.map((x) => x.cmd.kind)).toEqual(['RAISE', 'LOWER']);
  });

  it('is idempotent: a second drop emits no second LOWER', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onLevelChanged(1, 'https://a.test', 1);
    h.c.onLevelChanged(1, 'https://a.test', 1);
    expect(h.commands.filter((x) => x.cmd.kind === 'LOWER')).toHaveLength(1);
  });

  it('bumps generation on each RAISE/LOWER', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onLevelChanged(1, 'https://a.test', 1);
    const gens = h.commands.map((x) => x.cmd.generation);
    expect(gens[1] ?? 0).toBeGreaterThan(gens[0] ?? 0);
  });

  it('onActionLabel emits LABEL only while up', () => {
    const h = harness();
    h.c.onActionLabel(1, 'Clicking X'); // down -> ignored
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onActionLabel(1, 'Clicking X');
    const labels = h.commands.filter((x) => x.cmd.kind === 'LABEL');
    expect(labels).toHaveLength(1);
    expect((labels[0]?.cmd as { label: string }).label).toBe('Clicking X');
  });

  it('onStop calls dropToSafeLevel and does NOT itself LOWER', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.commands.length = 0;
    await h.c.onStop(1);
    expect(h.dropped).toEqual(['https://a.test']);
    expect(h.commands.filter((x) => x.cmd.kind === 'LOWER')).toHaveLength(0);
  });

  it('onHostConnectionChanged(false) drives all up tabs down', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onLevelChanged(2, 'https://b.test', 4);
    h.commands.length = 0;
    h.c.onHostConnectionChanged(false);
    const lowered = h.commands
      .filter((x) => x.cmd.kind === 'LOWER')
      .map((x) => x.tabId)
      .sort();
    expect(lowered).toEqual([1, 2]);
  });

  it('reconcile after generation reset converges at max(viewGen,gen)+1', async () => {
    const h = harness();
    await h.c.onViewReady(1, 'https://a.test', 5); // view already applied gen 5
    const raise = h.commands.find((x) => x.cmd.kind === 'RAISE');
    expect(raise).toBeDefined();
    expect(raise?.cmd.generation).toBeGreaterThan(5);
  });

  it('isUp reflects phase', () => {
    const h = harness();
    expect(h.c.isUp(1)).toBe(false); // before RAISE
    h.c.onLevelChanged(1, 'https://a.test', 4);
    expect(h.c.isUp(1)).toBe(true); // after RAISE
    h.c.onLevelChanged(1, 'https://a.test', 1);
    expect(h.c.isUp(1)).toBe(false); // after LOWER
  });
});

describe('ShieldController — handoff (Plan B)', () => {
  it('enterHandoff while up → pending; onUserResume(value) resolves {resumed:true,value} when readBack', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: true, timeoutMs: 1000 });
    h.c.onUserResume(1, { value: 'typed' });
    await expect(p).resolves.toMatchObject({ resumed: true, value: 'typed' });
    expect(h.commands.some((x) => x.cmd.kind === 'ENTER_HANDOFF')).toBe(true);
    expect(h.commands.some((x) => x.cmd.kind === 'EXIT_HANDOFF')).toBe(true);
  });
  it('readBack false → resume returns {resumed:true} with no value', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    h.c.onUserResume(1, { value: 'typed' });
    await expect(p).resolves.toEqual({ resumed: true });
  });
  it('enterHandoff while not up → {resumed:false,stopped}', async () => {
    const h = harness();
    await expect(
      h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1 }),
    ).resolves.toMatchObject({ resumed: false, reason: 'stopped' });
  });
  it('second enterHandoff while pending → {resumed:false,busy}; first still pending', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p1 = h.c.enterHandoff(1, { prompt: 'a', framing: 'f', readBack: false, timeoutMs: 1000 });
    await expect(
      h.c.enterHandoff(1, { prompt: 'b', framing: 'f', readBack: false, timeoutMs: 1000 }),
    ).resolves.toMatchObject({ resumed: false, reason: 'busy' });
    h.c.onUserResume(1);
    await expect(p1).resolves.toMatchObject({ resumed: true });
  });
  it('timeout → {resumed:false,timeout} + EXIT_HANDOFF, exactly once', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    h.fireTimer();
    await expect(p).resolves.toMatchObject({ resumed: false, reason: 'timeout' });
    h.c.onUserResume(1); // late resume must NOT double-resolve / re-EXIT
    expect(h.commands.filter((x) => x.cmd.kind === 'EXIT_HANDOFF')).toHaveLength(1);
  });
  it('level drop during handoff resolves {resumed:false,stopped} once', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    h.c.onLevelChanged(1, 'https://a.test', 1);
    await expect(p).resolves.toMatchObject({ resumed: false, reason: 'stopped' });
  });
  it('isHandoff + isShieldActive reflect the phase', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    void h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    expect(h.c.isHandoff(1)).toBe(true);
    expect(h.c.isShieldActive(1)).toBe(true); // up OR handoff
  });
  it('re-raise (onViewReady) during a pending handoff settles it once as stopped + no orphan timer', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    h.commands.length = 0;
    // Live-SW view re-handshake re-issues an up-state via reconcile() → #raise.
    await h.c.onViewReady(1, 'https://a.test', 0);
    await expect(p).resolves.toMatchObject({ resumed: false, reason: 'stopped' });
    // Re-raise must not strand the handoff: no EXIT_HANDOFF, view re-raises, phase up.
    expect(h.commands.some((x) => x.cmd.kind === 'RAISE')).toBe(true);
    expect(h.c.isHandoff(1)).toBe(false);
    expect(h.c.isShieldActive(1)).toBe(true);
    // Timer was cleared on settle: firing it afterward is a no-op (no double-resolve).
    h.commands.length = 0;
    h.fireTimer();
    expect(h.commands.filter((x) => x.cmd.kind === 'EXIT_HANDOFF')).toHaveLength(0);
  });
  it('reconcile via onHostConnectionChanged(true) during a pending handoff settles it once as stopped', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    // Wake reconcile path re-derives up and re-issues via #raise.
    h.c.onHostConnectionChanged(true);
    await expect(p).resolves.toMatchObject({ resumed: false, reason: 'stopped' });
    // Late timer fire is a no-op (record + timer already cleared).
    h.fireTimer();
    h.c.onUserResume(1);
    expect(h.commands.filter((x) => x.cmd.kind === 'EXIT_HANDOFF')).toHaveLength(0);
  });
  it('onTabClosed during a pending handoff resolves once as stopped; later timer fire is a no-op', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    h.commands.length = 0;
    // Tab closed mid-handoff (chrome.tabs.onRemoved → shield.onTabClosed): the
    // awaiting enterHandoff() promise must settle, not orphan, and the tab is
    // gone so no EXIT_HANDOFF view command is emitted.
    h.c.onTabClosed(1);
    await expect(p).resolves.toMatchObject({ resumed: false, reason: 'stopped' });
    expect(h.commands.filter((x) => x.cmd.kind === 'EXIT_HANDOFF')).toHaveLength(0);
    // The scheduled timeout callback is now a no-op (record + timer cleared,
    // tab forgotten): firing it must not double-resolve or re-EXIT.
    h.fireTimer();
    h.c.onUserResume(1);
    expect(h.commands.filter((x) => x.cmd.kind === 'EXIT_HANDOFF')).toHaveLength(0);
  });
});

describe('ShieldController — intent + scope (Part 2)', () => {
  it('onSetIntent sends a LABEL with the intent text (overrides per-action label)', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onActionLabel(1, "Clicking 'Apply'");
    h.c.onSetIntent(1, 'Applying · step 2/4');
    const labels = h.commands
      .filter((x) => x.cmd.kind === 'LABEL')
      .map((x) => (x.cmd as { label: string | null }).label);
    expect(labels.at(-1)).toBe('Applying · step 2/4');
    // a later per-action label does NOT override the intent
    h.c.onActionLabel(1, 'Typing into Email');
    expect(
      h.commands
        .filter((x) => x.cmd.kind === 'LABEL')
        .map((x) => (x.cmd as { label: string | null }).label)
        .at(-1),
    ).toBe('Applying · step 2/4');
  });
  it('onSetIntent defensively clips text to 80 chars (forged SW message)', () => {
    // FIX 4(b) (Part 2): the MCP zod enforces max(80), but a direct/forged
    // set_intent SW message could exceed it. The banner renders via textContent
    // (no XSS), but clip at the SW boundary for tidiness.
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'x'.repeat(200));
    const last = h.commands
      .filter((x) => x.cmd.kind === 'LABEL')
      .map((x) => (x.cmd as { label: string | null }).label)
      .at(-1);
    expect(last).not.toBeNull();
    expect((last as string).length).toBeLessThanOrEqual(80);
  });
  it("onSetIntent('') clears the intent (per-action label resumes)", () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'X');
    h.c.onSetIntent(1, '');
    h.c.onActionLabel(1, 'Clicking Y');
    expect(
      h.commands
        .filter((x) => x.cmd.kind === 'LABEL')
        .map((x) => (x.cmd as { label: string | null }).label)
        .at(-1),
    ).toBe('Clicking Y');
  });
  it('onSetIntent below up → no command', () => {
    const h = harness();
    h.c.onSetIntent(1, 'X');
    expect(h.commands.filter((x) => x.cmd.kind === 'LABEL')).toHaveLength(0);
  });
  it('enterHandoff threads scope into ENTER_HANDOFF', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    void h.c.enterHandoff(1, {
      prompt: 'p',
      framing: 'f',
      scope: 'page',
      readBack: false,
      timeoutMs: 1000,
    });
    const enter = h.commands.find((x) => x.cmd.kind === 'ENTER_HANDOFF');
    expect((enter?.cmd as { scope?: string }).scope).toBe('page');
  });
  it('refreshes the banner label on handoff exit (set_intent during handoff is not stale)', async () => {
    // FIX 2 (Part 2): a set_intent issued DURING a handoff updates the
    // controller's intentLabel, but the view drops LABEL while phase==='handoff'
    // (its LABEL case only applies while up). On resume, EXIT_HANDOFF flips the
    // view back to up but the banner still shows the pre-handoff intent unless
    // the controller re-pushes the label. #settleHandoff must re-push it.
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    const p = h.c.enterHandoff(1, { prompt: 'x', framing: 'f', readBack: false, timeoutMs: 1000 });
    h.c.onSetIntent(1, 'Step 3/4'); // issued during the handoff
    h.commands.length = 0;
    h.c.onUserResume(1);
    await expect(p).resolves.toMatchObject({ resumed: true });
    const exitIdx = h.commands.findIndex((x) => x.cmd.kind === 'EXIT_HANDOFF');
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    const labelsAfterExit = h.commands
      .slice(exitIdx)
      .filter((x) => x.cmd.kind === 'LABEL')
      .map((x) => (x.cmd as { label: string | null }).label);
    expect(labelsAfterExit.at(-1)).toBe('Step 3/4');
  });
  it('intentLabel is cleared on LOWER', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'X');
    h.c.onLevelChanged(1, 'https://a.test', 1);
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onActionLabel(1, 'Z');
    expect(
      h.commands
        .filter((x) => x.cmd.kind === 'LABEL')
        .map((x) => (x.cmd as { label: string | null }).label)
        .at(-1),
    ).toBe('Z');
  });
  it('onSetIntent with status:done emits a TERMINAL command (not LABEL)', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'Application submitted', 'done');
    const terminals = h.commands.filter((x) => x.cmd.kind === 'TERMINAL');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]?.cmd).toMatchObject({
      kind: 'TERMINAL',
      status: 'done',
      label: 'Application submitted',
    });
  });
  it('onSetIntent with status:failed emits a failed TERMINAL', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, "stopped — salary didn't take", 'failed');
    expect(h.commands.filter((x) => x.cmd.kind === 'TERMINAL')[0]?.cmd).toMatchObject({
      status: 'failed',
      label: "stopped — salary didn't take",
    });
  });
  it('onSetIntent without status still emits a LABEL (backward-compatible)', () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'step 2/4');
    expect(h.commands.filter((x) => x.cmd.kind === 'TERMINAL')).toHaveLength(0);
    expect(h.commands.filter((x) => x.cmd.kind === 'LABEL')).not.toHaveLength(0);
  });
  it('onSetIntent with status while down emits nothing', () => {
    const h = harness();
    h.c.onSetIntent(1, 'done?', 'done'); // never raised → phase down
    expect(h.commands.filter((x) => x.cmd.kind === 'TERMINAL')).toHaveLength(0);
  });

  it('failed terminal is re-emitted after a reconcile (survives SW wake)', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'oops', 'failed');
    const firstTerminalIdx = h.commands.findIndex((x) => x.cmd.kind === 'TERMINAL');
    expect(firstTerminalIdx).toBeGreaterThanOrEqual(0);
    // SW eviction + wake → re-handshake funnels through reconcile → #raise.
    await h.c.reconcile(1, 'https://a.test');
    const terminals = h.commands.filter((x) => x.cmd.kind === 'TERMINAL');
    expect(terminals.length).toBeGreaterThanOrEqual(2);
    expect(terminals.at(-1)?.cmd).toMatchObject({ status: 'failed', label: 'oops' });
    // The re-emit lands AFTER a RAISE (the reconcile's #raise repaired the view first).
    const raiseAfterFirst = h.commands
      .slice(firstTerminalIdx + 1)
      .some((x) => x.cmd.kind === 'RAISE');
    expect(raiseAfterFirst).toBe(true);
  });

  it('done terminal is NOT re-emitted after a reconcile', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'ok', 'done');
    await h.c.reconcile(1, 'https://a.test');
    expect(h.commands.filter((x) => x.cmd.kind === 'TERMINAL')).toHaveLength(1);
  });

  it('a no-status set_intent clears the persisted failed', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'oops', 'failed');
    h.c.onSetIntent(1, 'step 2'); // ongoing label supersedes the failed terminal
    const beforeReconcile = h.commands.filter((x) => x.cmd.kind === 'TERMINAL').length;
    await h.c.reconcile(1, 'https://a.test');
    // No NEW terminal after the reconcile — the persisted failed was cleared.
    expect(h.commands.filter((x) => x.cmd.kind === 'TERMINAL')).toHaveLength(beforeReconcile);
  });

  it('enterHandoff clears the persisted failed', async () => {
    const h = harness();
    h.c.onLevelChanged(1, 'https://a.test', 4);
    h.c.onSetIntent(1, 'oops', 'failed');
    // A handoff supersedes the terminal (mirrors the view clearing it on ENTER_HANDOFF).
    void h.c.enterHandoff(1, { prompt: 'p', framing: 'f', readBack: false, timeoutMs: 1000 });
    const before = h.commands.filter((x) => x.cmd.kind === 'TERMINAL').length;
    // A reconcile while in handoff aborts the handoff and re-raises; assert the
    // re-raise does NOT re-emit a terminal (enterHandoff cleared s.terminal).
    await h.c.reconcile(1, 'https://a.test');
    expect(h.commands.filter((x) => x.cmd.kind === 'TERMINAL')).toHaveLength(before);
  });
});
