// Tests for the Supervisor core — spawn + monitor + status (SP6b-2 Task 4 + 5).
// All I/O is injected: fake spawn returns a controllable ChildLike backed by a
// tiny EventEmitter stub; writeStatus captures calls; resolveSpawn is a
// pass-through that returns fixed command/args.

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { ConnectorEntry } from './registry.js';
import { type ChildLike, type ConnectorStatus, Supervisor } from './supervisor.js';

// ── Fake ChildLike ─────────────────────────────────────────────────────────

/** A ChildLike stub whose exit event can be fired manually via `.emitExit()`. */
interface FakeChild extends ChildLike {
  /** Fire the 'exit' event with the supplied exit code. */
  emitExit(code: number | null): void;
  killCalls: Array<string | undefined>;
}

function makeChild(pid: number): FakeChild {
  const ee = new EventEmitter();
  const killCalls: Array<string | undefined> = [];
  return {
    pid,
    on(event: 'exit', cb: (code: number | null) => void) {
      ee.on(event, cb);
    },
    kill(signal?: string) {
      killCalls.push(signal);
    },
    emitExit(code: number | null) {
      ee.emit('exit', code);
    },
    killCalls,
  };
}

// ── Fake timer ─────────────────────────────────────────────────────────────

interface ScheduledTimer {
  fn: () => void;
  ms: number;
  handle: symbol;
  cancelled: boolean;
}

interface FakeTimers {
  scheduled: ScheduledTimer[];
  /** Invoke the first non-cancelled pending timer (oldest). */
  advanceNext(): void;
  /** Invoke all non-cancelled pending timers. */
  advanceAll(): void;
}

function makeFakeTimers(): {
  timers: FakeTimers;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
} {
  const scheduled: ScheduledTimer[] = [];

  const setTimer = (fn: () => void, ms: number): unknown => {
    const handle = Symbol('timer');
    scheduled.push({ fn, ms, handle, cancelled: false });
    return handle;
  };

  const clearTimer = (t: unknown): void => {
    for (const timer of scheduled) {
      if (timer.handle === t) {
        timer.cancelled = true;
      }
    }
  };

  const timers: FakeTimers = {
    scheduled,
    advanceNext() {
      const t = scheduled.find((x) => !x.cancelled);
      if (t) {
        t.cancelled = true;
        t.fn();
      }
    },
    advanceAll() {
      const pending = scheduled.filter((x) => !x.cancelled);
      for (const t of pending) {
        t.cancelled = true;
        t.fn();
      }
    },
  };

  return { timers, setTimer, clearTimer };
}

// ── Fake deps factory ──────────────────────────────────────────────────────

interface FakeDeps {
  spawnCalls: Array<{ command: string; args: string[]; name: string }>;
  statusSnapshots: Array<Record<string, ConnectorStatus>>;
  children: Map<string, FakeChild>; // name → most-recently spawned child
  nextPid: number;
  nowMs: number; // fake wall clock; advance to simulate time passing
}

function makeDeps(fakeDepsOut: FakeDeps, fakeTimers: ReturnType<typeof makeFakeTimers>) {
  // resolveSpawn: return a predictable command from the entry's surface name
  const resolveSpawn = (entry: ConnectorEntry) => ({
    command: `peek-connector-${entry.surface}`,
    args: [] as string[],
  });

  const spawn = (command: string, args: string[], name: string): ChildLike => {
    const pid = fakeDepsOut.nextPid++;
    fakeDepsOut.spawnCalls.push({ command, args, name });
    const child = makeChild(pid);
    fakeDepsOut.children.set(name, child);
    return child;
  };

  const writeStatus = (status: Record<string, ConnectorStatus>) => {
    // Capture a deep clone so later mutations don't change the snapshot.
    fakeDepsOut.statusSnapshots.push(
      JSON.parse(JSON.stringify(status)) as Record<string, ConnectorStatus>,
    );
  };

  return {
    spawn,
    now: () => fakeDepsOut.nowMs,
    setTimer: fakeTimers.setTimer,
    clearTimer: fakeTimers.clearTimer,
    resolveSpawn,
    writeStatus,
  };
}

function makeFakeDeps(): FakeDeps {
  return {
    spawnCalls: [],
    statusSnapshots: [],
    children: new Map(),
    nextPid: 100,
    nowMs: 0,
  };
}

// Helper: build a complete supervisor + fake deps wired together
function makeSupFromConnectors(connectors: Record<string, ConnectorEntry>) {
  const out = makeFakeDeps();
  const ft = makeFakeTimers();
  const deps = makeDeps(out, ft);
  const sup = new Supervisor(connectors, deps);
  return { sup, out, ft, deps };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Supervisor.start()', () => {
  it('spawns an enabled connector via resolveSpawn with correct command, args, and name', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    expect(out.spawnCalls).toHaveLength(1);
    const call = out.spawnCalls[0];
    expect(call).toBeDefined();
    if (!call) return;
    expect(call.command).toBe('peek-connector-slack');
    expect(call.args).toEqual([]);
    expect(call.name).toBe('peek-slack');
  });

  it('does NOT spawn a disabled connector', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: false },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    expect(out.spawnCalls).toHaveLength(0);
  });

  it('calls writeStatus after spawning with state=running and pid set', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    // At minimum one writeStatus call for the spawned connector.
    expect(out.statusSnapshots.length).toBeGreaterThanOrEqual(1);
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    const entry = last['peek-slack'];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.state).toBe('running');
    expect(entry.pid).toBe(100); // first pid assigned
    expect(entry.restarts).toBe(0);
  });

  it('spawns both enabled connectors when two are present', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
      'peek-discord': { surface: 'discord', enabled: true },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    expect(out.spawnCalls).toHaveLength(2);
    const names = out.spawnCalls.map((c) => c.name).sort();
    expect(names).toEqual(['peek-discord', 'peek-slack']);

    // Both should be running in the final status snapshot.
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last['peek-slack']?.state).toBe('running');
    expect(last['peek-discord']?.state).toBe('running');
  });

  it('skips disabled connectors but still spawns enabled ones in mixed set', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
      'peek-teams': { surface: 'teams', enabled: false },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    // Only the enabled one is spawned.
    expect(out.spawnCalls).toHaveLength(1);
    expect(out.spawnCalls[0]?.name).toBe('peek-slack');

    // Disabled connector is absent from the status snapshot.
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    expect(last['peek-teams']).toBeUndefined();
  });
});

describe('Supervisor — on child exit (Task-4 behavior)', () => {
  it('marks the connector stopped with lastExitCode after child exits', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    // Trigger the exit event.
    const child = out.children.get('peek-slack');
    expect(child).toBeDefined();
    if (!child) return;
    child.emitExit(1);

    // The latest writeStatus snapshot should show stopped.
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    const entry = last['peek-slack'];
    expect(entry).toBeDefined();
    if (!entry) return;
    // Task 5: after exit it's backing-off now, not stopped
    expect(entry.state).toBe('backing-off');
    expect(entry.lastExitCode).toBe(1);
  });

  it('handles a null exit code (process.kill SIGTERM) and omits lastExitCode', () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    const child = out.children.get('peek-slack');
    expect(child).toBeDefined();
    if (!child) return;
    child.emitExit(null); // SIGTERM-style

    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last).toBeDefined();
    if (!last) return;
    const entry = last['peek-slack'];
    expect(entry).toBeDefined();
    if (!entry) return;
    // Task 5: after exit it's backing-off now
    expect(entry.state).toBe('backing-off');
    // `lastExitCode` must be absent (exactOptionalPropertyTypes compliance).
    expect('lastExitCode' in entry).toBe(false);
  });
});

describe('Supervisor.shutdown()', () => {
  it('returns a Promise and resolves immediately when no children are alive (no connectors)', async () => {
    const out = makeFakeDeps();
    const ft = makeFakeTimers();
    const deps = makeDeps(out, ft);
    const connectors: Record<string, ConnectorEntry> = {};

    const sup = new Supervisor(connectors, deps);
    sup.start();
    // No children → should resolve without needing to advance timers.
    await expect(sup.shutdown()).resolves.toBeUndefined();
  });

  it('resolves immediately when the only connector is backing-off (no live child to await)', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    const child = out.children.get('peek-slack');
    if (!child) throw new Error('no child spawned');
    child.emitExit(1); // → backing-off; its child process is now dead.

    // A backing-off connector has no live child that will emit 'exit', so
    // shutdown must NOT arm the SIGKILL grace timer for it and must resolve
    // immediately — otherwise `peek connect stop` stalls ~5.5s per backoff.
    const p = sup.shutdown();
    const pending = ft.timers.scheduled.filter((t) => !t.cancelled);
    expect(pending).toHaveLength(0); // fails fast if a grace timer was armed
    await expect(p).resolves.toBeUndefined();
  });
});

// ── Task 5: restart-with-backoff ───────────────────────────────────────────

describe('Supervisor — restart-with-backoff (Task 5)', () => {
  it('schedules a restart after 1000ms on first exit', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    const child = out.children.get('peek-slack');
    expect(child).toBeDefined();
    if (!child) return;

    child.emitExit(1);

    // Should have scheduled exactly one timer for 1000ms
    const pending = ft.timers.scheduled.filter((t) => !t.cancelled);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.ms).toBe(1000);

    // Status should be backing-off
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    const entry = last?.['peek-slack'];
    expect(entry?.state).toBe('backing-off');
    expect(entry?.nextRetryAtMs).toBe(1000);
  });

  it('respawns the connector when the timer fires', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();
    expect(out.spawnCalls).toHaveLength(1);

    out.children.get('peek-slack')?.emitExit(1);

    // Advance the clock past 1000ms and fire the timer
    out.nowMs = 1001;
    ft.timers.advanceNext();

    // A second spawn should have happened
    expect(out.spawnCalls).toHaveLength(2);

    // Status should be running again with restarts=1
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    const entry = last?.['peek-slack'];
    expect(entry?.state).toBe('running');
    expect(entry?.restarts).toBe(1);
  });

  it('doubles the backoff delay on consecutive exits: 1000ms → 2000ms → 4000ms', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    // First exit → 1000ms backoff
    out.children.get('peek-slack')?.emitExit(1);
    expect(ft.timers.scheduled.filter((t) => !t.cancelled)[0]?.ms).toBe(1000);
    ft.timers.advanceNext(); // fire → respawn

    // Second exit → 2000ms backoff
    out.children.get('peek-slack')?.emitExit(1);
    expect(ft.timers.scheduled.filter((t) => !t.cancelled)[0]?.ms).toBe(2000);
    ft.timers.advanceNext(); // fire → respawn

    // Third exit → 4000ms backoff
    out.children.get('peek-slack')?.emitExit(1);
    expect(ft.timers.scheduled.filter((t) => !t.cancelled)[0]?.ms).toBe(4000);
  });

  it('caps backoff at 60000ms', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    // Trigger many consecutive exits to reach the cap
    // 1000, 2000, 4000, 8000, 16000, 32000, 64000 → capped at 60000
    for (let i = 0; i < 6; i++) {
      out.children.get('peek-slack')?.emitExit(1);
      ft.timers.advanceNext();
    }

    // 7th exit: 2^6 = 64, * 1000 = 64000 → capped to 60000
    out.children.get('peek-slack')?.emitExit(1);
    const pending = ft.timers.scheduled.filter((t) => !t.cancelled);
    expect(pending[pending.length - 1]?.ms).toBe(60_000);
  });

  it('resets attempts when child is stable for ≥30000ms before exiting', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start(); // nowMs=0, upSince=0

    // First exit → attempts=1, 1000ms backoff
    out.children.get('peek-slack')?.emitExit(1);
    ft.timers.advanceNext(); // respawn at t=0

    // Second exit immediately → attempts=2, 2000ms backoff
    out.children.get('peek-slack')?.emitExit(1);
    ft.timers.advanceNext(); // respawn

    // Now advance clock past STABILITY_MS (30_000) and exit
    out.nowMs = 40_000;
    out.children.get('peek-slack')?.emitExit(0);

    // attempts should have reset to 0 (child was up >= 30000ms), next delay = 1000ms
    const pending = ft.timers.scheduled.filter((t) => !t.cancelled);
    expect(pending[pending.length - 1]?.ms).toBe(1000);
  });

  it('sets nextRetryAtMs = now + delay in the backing-off status', () => {
    const { sup, out } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    out.nowMs = 5000;
    out.children.get('peek-slack')?.emitExit(1);

    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    const entry = last?.['peek-slack'];
    expect(entry?.state).toBe('backing-off');
    // nextRetryAtMs = 5000 + 1000 = 6000
    expect(entry?.nextRetryAtMs).toBe(6000);
  });

  it('includes the restart count in backing-off status', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    // Exit once, fire timer, exit again
    out.children.get('peek-slack')?.emitExit(1);
    ft.timers.advanceNext(); // respawn
    out.children.get('peek-slack')?.emitExit(1);

    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    const entry = last?.['peek-slack'];
    expect(entry?.restarts).toBe(2);
  });
});

// ── Task 5: shutdown ───────────────────────────────────────────────────────

describe('Supervisor — shutdown() (Task 5)', () => {
  it('kills each live child with SIGTERM on shutdown', () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
      'peek-discord': { surface: 'discord', enabled: true },
    });
    sup.start();

    const slack = out.children.get('peek-slack');
    const discord = out.children.get('peek-discord');
    expect(slack).toBeDefined();
    expect(discord).toBeDefined();

    // Start shutdown (don't await — we drive resolution via fake timers below).
    const p = sup.shutdown();

    expect(slack?.killCalls).toContain('SIGTERM');
    expect(discord?.killCalls).toContain('SIGTERM');

    // Simulate children exiting (SIGTERM was acknowledged) so the promise settles.
    slack?.emitExit(null);
    discord?.emitExit(null);
    ft.timers.advanceAll();
    return p;
  });

  it('marks all connectors stopped after shutdown', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    const p = sup.shutdown();
    // Simulate child exit so promise resolves (clean SIGTERM path).
    out.children.get('peek-slack')?.emitExit(null);
    ft.timers.advanceAll();
    await p;

    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last?.['peek-slack']?.state).toBe('stopped');
  });

  it('writes a final status snapshot after shutdown', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    const snapshotsBefore = out.statusSnapshots.length;
    const p = sup.shutdown();
    out.children.get('peek-slack')?.emitExit(null);
    ft.timers.advanceAll();
    await p;

    expect(out.statusSnapshots.length).toBeGreaterThan(snapshotsBefore);
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last?.['peek-slack']?.state).toBe('stopped');
  });

  it('clears any pending restart timers on shutdown', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    // Trigger an exit → pending restart timer
    out.children.get('peek-slack')?.emitExit(1);
    const pendingBefore = ft.timers.scheduled.filter((t) => !t.cancelled);
    expect(pendingBefore.length).toBeGreaterThanOrEqual(1);

    const p = sup.shutdown();
    // Advance all timers including SIGKILL grace + fallback to settle the promise.
    ft.timers.advanceAll();
    ft.timers.advanceAll();
    await p;

    // The restart timer (1000ms) should be cancelled.
    const restartTimers = ft.timers.scheduled.filter((t) => t.cancelled && t.ms === 1000);
    expect(restartTimers.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT restart a connector that exits AFTER shutdown', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();
    expect(out.spawnCalls).toHaveLength(1);

    const p = sup.shutdown();

    // Child reports exit AFTER shutdown (e.g. delayed SIGTERM response).
    out.children.get('peek-slack')?.emitExit(null);
    ft.timers.advanceAll();
    await p;

    // No new spawns should happen.
    expect(out.spawnCalls).toHaveLength(1);
    // Status remains stopped (not backing-off).
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last?.['peek-slack']?.state).toBe('stopped');
  });

  it('does NOT restart a connector in backing-off state when shutdown fires', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    // Exit → backing-off with pending timer.
    out.children.get('peek-slack')?.emitExit(1);

    // Shutdown before the restart fires.
    const p = sup.shutdown();

    // Advance all timers (SIGKILL grace + fallback).
    ft.timers.advanceAll();
    ft.timers.advanceAll();
    await p;

    expect(out.spawnCalls).toHaveLength(1);
    const last = out.statusSnapshots[out.statusSnapshots.length - 1];
    expect(last?.['peek-slack']?.state).toBe('stopped');
  });

  it('resolves immediately when there are no live children at shutdown time', async () => {
    const { sup } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: false }, // disabled — not spawned
    });
    sup.start();
    // No alive children; shutdown promise must resolve without advancing timers.
    await expect(sup.shutdown()).resolves.toBeUndefined();
  });

  it('escalates to SIGKILL after grace period for a child that ignores SIGTERM, then resolves', async () => {
    const { sup, out, ft } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    const child = out.children.get('peek-slack');
    expect(child).toBeDefined();
    if (!child) return;

    // Start shutdown — child does NOT exit on SIGTERM (ignores it).
    const shutdownPromise = sup.shutdown();

    expect(child.killCalls).toContain('SIGTERM');
    // Promise is still pending (child hasn't exited yet).
    let resolved = false;
    void shutdownPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Advance the fake clock past SIGKILL_GRACE_MS (5000ms timer).
    ft.timers.advanceNext(); // fires the SIGKILL grace timer
    expect(child.killCalls).toContain('SIGKILL');

    // Advance past the SIGKILL_FALLBACK_MS (500ms) bounded-resolve timer.
    ft.timers.advanceNext(); // fires the fallback resolve timer
    await shutdownPromise;

    expect(resolved).toBe(true);
  });

  it('resolves via exit listener (clean SIGTERM path) — does NOT wait for grace timer', async () => {
    const { sup, out } = makeSupFromConnectors({
      'peek-slack': { surface: 'slack', enabled: true },
    });
    sup.start();

    const child = out.children.get('peek-slack');
    expect(child).toBeDefined();
    if (!child) return;

    const p = sup.shutdown();

    // Child exits promptly in response to SIGTERM.
    child.emitExit(0);
    // Promise should resolve without needing the SIGKILL grace timer.
    await p;

    // SIGKILL grace timer was cleared (child exited before the grace elapsed)
    // or fired and found no survivors. Either way, SIGKILL must NOT have been sent.
    expect(child.killCalls).not.toContain('SIGKILL');
  });
});
