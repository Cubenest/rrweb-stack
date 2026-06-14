import { describe, expect, it } from 'vitest';
import { ShieldController, type ShieldControllerDeps } from '../shield/controller';
import type { ViewCommand } from '../shield/protocol';

function harness(opts: { connected?: boolean; level?: number } = {}) {
  const commands: Array<{ tabId: number; cmd: ViewCommand }> = [];
  const dropped: string[] = [];
  let connected = opts.connected ?? true;
  let level = opts.level ?? 4;
  const deps: ShieldControllerDeps = {
    commandView: (tabId, cmd) => commands.push({ tabId, cmd }),
    dropToSafeLevel: async (origin) => {
      dropped.push(origin);
    },
    isHostConnected: () => connected,
    getEffectiveLevel: async () => level,
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
