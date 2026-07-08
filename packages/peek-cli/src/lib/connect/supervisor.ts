// Supervisor core for `peek connect` — spawn each enabled connector once,
// track it in an in-memory Map, and write status.json on every state change.
// Restart-with-backoff (Task 5) extends this class; shutdown is a stub here.

import type { ConnectorEntry } from './registry.js';

// ── Backoff constants ──────────────────────────────────────────────────────

/** A process running for at least this many ms is considered stable; on exit
 * its restart attempt counter resets to 0 so the next backoff starts fresh. */
const STABILITY_MS = 30_000;

/** Base delay (ms) for the first restart attempt. */
const BACKOFF_BASE_MS = 1_000;

/** Maximum backoff delay (ms); delays are capped here. */
const BACKOFF_CAP_MS = 60_000;

/** Grace period (ms) between SIGTERM and SIGKILL during shutdown. */
const SIGKILL_GRACE_MS = 5_000;

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
  /** Number of restart attempts since the last stability reset. */
  attempts: number;
  /** Timestamp (from deps.now()) when the current child was spawned. */
  upSince: number;
  /** Handle for any pending restart timer (for cancellation on shutdown). */
  restartTimer: unknown;
}

// ── Supervisor ─────────────────────────────────────────────────────────────

/**
 * Core supervisor for `peek connect`. Spawns each enabled connector as a
 * subprocess, listens for its exit, and persists status to disk after every
 * state change.
 *
 * Task 4 scope: spawn-once + exit-marks-stopped.
 * Task 5 scope: restart-with-exponential-backoff + graceful shutdown.
 */
export class Supervisor {
  readonly #connectors: Record<string, ConnectorEntry>;
  readonly #deps: SupervisorDeps;
  readonly #slots: Map<string, Slot> = new Map();
  /** Set to true on the first shutdown() call; prevents restart scheduling. */
  #down = false;

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
   * Graceful shutdown: set the down flag, clear all pending restart timers,
   * send SIGTERM to each live child (with a SIGKILL escalation after a grace
   * period), mark all connectors stopped, and write a final status snapshot.
   */
  shutdown(): void {
    this.#down = true;

    for (const [name, slot] of this.#slots) {
      // Cancel any pending restart timer for this connector.
      if (slot.restartTimer !== undefined) {
        this.#deps.clearTimer(slot.restartTimer);
        slot.restartTimer = undefined;
      }

      // Kill the live child if it is still running.
      if (slot.status.state === 'running' || slot.status.state === 'backing-off') {
        try {
          slot.child.kill('SIGTERM');
        } catch {
          // Ignore — child may already be gone.
        }

        // Escalate to SIGKILL after the grace period (kept deterministic via
        // injected setTimer so tests can advance the fake clock if needed).
        this.#deps.setTimer(() => {
          try {
            slot.child.kill('SIGKILL');
          } catch {
            // Ignore.
          }
        }, SIGKILL_GRACE_MS);
      }

      // Mark stopped immediately (we're done managing this connector).
      const stopped: ConnectorStatus = {
        state: 'stopped',
        restarts: slot.attempts,
      };
      slot.status = stopped;

      // Update the slot name ref for the snapshot below.
      this.#slots.set(name, slot);
    }

    this.#deps.writeStatus(this.#statusSnapshot());
  }

  // ── Private ──────────────────────────────────────────────────────────────

  #spawnOne(name: string, entry: ConnectorEntry): void {
    const { command, args } = this.#deps.resolveSpawn(entry);
    const child = this.#deps.spawn(command, args, name);

    // Look up the existing slot to carry forward the accumulated attempt count.
    const existing = this.#slots.get(name);
    const attempts = existing?.attempts ?? 0;
    const upSince = this.#deps.now();

    const status: ConnectorStatus = {
      state: 'running',
      restarts: attempts,
      ...(child.pid !== undefined ? { pid: child.pid } : {}),
    };

    this.#slots.set(name, { child, status, attempts, upSince, restartTimer: undefined });
    this.#deps.writeStatus(this.#statusSnapshot());

    child.on('exit', (code) => {
      this.#onExit(name, code);
    });
  }

  /**
   * Exit handler with exponential-backoff restart (Task 5).
   *
   * If the supervisor is shutting down, mark stopped and return — do not
   * schedule a restart. Otherwise compute the next delay using a doubling
   * schedule (capped at BACKOFF_CAP_MS), update status to `backing-off`, and
   * schedule a respawn via deps.setTimer.
   *
   * A child that ran for at least STABILITY_MS before exiting is treated as
   * having recovered; its attempt counter resets to 0 so the backoff restarts
   * from the base delay.
   */
  #onExit(name: string, code: number | null): void {
    const slot = this.#slots.get(name);
    if (slot === undefined) return;

    // If shutting down, just record stopped — no restart.
    if (this.#down) {
      const stopped: ConnectorStatus = {
        state: 'stopped',
        restarts: slot.attempts,
        ...(code !== null ? { lastExitCode: code } : {}),
      };
      slot.status = stopped;
      this.#deps.writeStatus(this.#statusSnapshot());
      return;
    }

    // Retrieve the entry so we can respawn with the same config.
    const entry = this.#connectors[name];
    if (entry === undefined) return;

    // Reset attempts if the child was stable long enough. Use the pre-increment
    // attempt count to compute the delay so the first restart is BACKOFF_BASE_MS
    // (2^0 = 1), the second is 2×BACKOFF_BASE_MS (2^1 = 2), and so on.
    const wasStable = this.#deps.now() - slot.upSince >= STABILITY_MS;
    const prevAttempts = wasStable ? 0 : slot.attempts;
    const attempts = prevAttempts + 1;

    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** prevAttempts);

    const backingOff: ConnectorStatus = {
      state: 'backing-off',
      restarts: attempts,
      nextRetryAtMs: this.#deps.now() + delay,
      ...(code !== null ? { lastExitCode: code } : {}),
    };

    slot.status = backingOff;
    slot.attempts = attempts;

    const timer = this.#deps.setTimer(() => {
      this.#spawnOne(name, entry);
    }, delay);
    slot.restartTimer = timer;

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
