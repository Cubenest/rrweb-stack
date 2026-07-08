// Tests for the Supervisor core — spawn + monitor + status (SP6b-2 Task 4).
// All I/O is injected: fake spawn returns a controllable ChildLike backed by a
// tiny EventEmitter stub; writeStatus captures calls; resolveSpawn is a
// pass-through that returns fixed command/args.

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
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

// ── Fake deps factory ──────────────────────────────────────────────────────

interface FakeDeps {
  spawnCalls: Array<{ command: string; args: string[]; name: string }>;
  statusSnapshots: Array<Record<string, ConnectorStatus>>;
  children: Map<string, FakeChild>; // name → child (keyed by 3rd spawn arg)
  nextPid: number;
}

function makeDeps(fakeDepsOut: FakeDeps) {
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
    now: () => 0,
    setTimer: vi.fn((_fn: () => void, _ms: number) => undefined as unknown),
    clearTimer: vi.fn((_t: unknown) => undefined),
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
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Supervisor.start()', () => {
  it('spawns an enabled connector via resolveSpawn with correct command, args, and name', () => {
    const out = makeFakeDeps();
    const deps = makeDeps(out);
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
    const deps = makeDeps(out);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: false },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();

    expect(out.spawnCalls).toHaveLength(0);
  });

  it('calls writeStatus after spawning with state=running and pid set', () => {
    const out = makeFakeDeps();
    const deps = makeDeps(out);
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
    const deps = makeDeps(out);
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
    const deps = makeDeps(out);
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
    const deps = makeDeps(out);
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
    expect(entry.state).toBe('stopped');
    expect(entry.lastExitCode).toBe(1);
    expect(entry.restarts).toBe(0);
  });

  it('handles a null exit code (process.kill SIGTERM) and omits lastExitCode', () => {
    const out = makeFakeDeps();
    const deps = makeDeps(out);
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
    expect(entry.state).toBe('stopped');
    // `lastExitCode` must be absent (exactOptionalPropertyTypes compliance).
    expect('lastExitCode' in entry).toBe(false);
  });
});

describe('Supervisor.shutdown()', () => {
  it('does not throw (stub behavior for Task 4)', () => {
    const out = makeFakeDeps();
    const deps = makeDeps(out);
    const connectors: Record<string, ConnectorEntry> = {
      'peek-slack': { surface: 'slack', enabled: true },
    };

    const sup = new Supervisor(connectors, deps);
    sup.start();
    expect(() => sup.shutdown()).not.toThrow();
  });
});
