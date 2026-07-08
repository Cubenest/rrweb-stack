// Supervisor core for `peek connect` — spawn each enabled connector once,
// track it in an in-memory Map, and write status.json on every state change.
// Restart-with-backoff (Task 5) extends this class; shutdown is a stub here.

import type { ConnectorEntry } from './registry.js';

// ── Public types ───────────────────────────────────────────────────────────

/**
 * A subset of Node's ChildProcess that the Supervisor depends on — narrow
 * interface so tests can inject a lightweight stub without a full ChildProcess.
 */
export interface ChildLike {
  pid?: number;
  on(event: 'exit', cb: (code: number | null) => void): void;
  kill(signal?: string): void;
}

/** Per-connector runtime status written to status.json. */
export interface ConnectorStatus {
  state: 'running' | 'backing-off' | 'stopped';
  pid?: number;
  restarts: number;
  lastExitCode?: number;
  nextRetryAtMs?: number;
}

/** Injectable dependencies for Supervisor — all side-effects are injected. */
export interface SupervisorDeps {
  /** Spawn a subprocess for the named connector. */
  spawn: (command: string, args: string[], name: string) => ChildLike;
  /** Wall-clock in milliseconds (injectable for tests). */
  now: () => number;
  /** Schedule a one-shot callback (injectable for tests). */
  setTimer: (fn: () => void, ms: number) => unknown;
  /** Cancel a previously scheduled timer. */
  clearTimer: (t: unknown) => void;
  /** Resolve the spawn command + args for a registry entry. */
  resolveSpawn: (entry: ConnectorEntry) => { command: string; args: string[] };
  /** Persist the current status snapshot (e.g. write status.json). */
  writeStatus: (status: Record<string, ConnectorStatus>) => void;
}

// ── Internal slot ──────────────────────────────────────────────────────────

interface Slot {
  child: ChildLike;
  status: ConnectorStatus;
}

// ── Supervisor ─────────────────────────────────────────────────────────────

/**
 * Core supervisor for `peek connect`. Spawns each enabled connector as a
 * subprocess, listens for its exit, and persists status to disk after every
 * state change.
 *
 * Task 4 scope: spawn-once + exit-marks-stopped. Restart-with-backoff and a
 * full shutdown implementation land in Task 5.
 */
export class Supervisor {
  readonly #connectors: Record<string, ConnectorEntry>;
  readonly #deps: SupervisorDeps;
  readonly #slots: Map<string, Slot> = new Map();

  constructor(connectors: Record<string, ConnectorEntry>, deps: SupervisorDeps) {
    this.#connectors = connectors;
    this.#deps = deps;
  }

  /** Spawn all enabled connectors and begin monitoring. */
  start(): void {
    for (const [name, entry] of Object.entries(this.#connectors)) {
      if (!entry.enabled) continue;
      this.#spawnOne(name, entry);
    }
  }

  /**
   * Graceful shutdown stub — Task 5 implements this fully (kill children,
   * clear pending timers, set the down flag). Present here so callers can
   * wire it up without waiting for Task 5.
   */
  shutdown(): void {
    // Task 5 body goes here.
  }

  // ── Private ──────────────────────────────────────────────────────────────

  #spawnOne(name: string, entry: ConnectorEntry): void {
    const { command, args } = this.#deps.resolveSpawn(entry);
    const child = this.#deps.spawn(command, args, name);

    const status: ConnectorStatus = {
      state: 'running',
      restarts: 0,
      ...(child.pid !== undefined ? { pid: child.pid } : {}),
    };

    this.#slots.set(name, { child, status });
    this.#deps.writeStatus(this.#statusSnapshot());

    child.on('exit', (code) => {
      this.#onExit(name, code);
    });
  }

  /**
   * Task-4 exit handler: mark the connector stopped + persist status.
   * Task 5 replaces this body with backoff-restart logic.
   */
  #onExit(name: string, code: number | null): void {
    const slot = this.#slots.get(name);
    if (slot === undefined) return;

    const next: ConnectorStatus = {
      state: 'stopped',
      restarts: slot.status.restarts,
      ...(code !== null ? { lastExitCode: code } : {}),
    };

    slot.status = next;
    this.#deps.writeStatus(this.#statusSnapshot());
  }

  /** Build a fresh status snapshot from the current in-memory slots. */
  #statusSnapshot(): Record<string, ConnectorStatus> {
    const snapshot: Record<string, ConnectorStatus> = {};
    for (const [name, slot] of this.#slots) {
      snapshot[name] = { ...slot.status };
    }
    return snapshot;
  }
}
