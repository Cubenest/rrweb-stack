// `peek connect <add|list|remove|start|stop|status|logs|__supervise>` command
// shell (SP6b-2). The connector registry lives in ~/.peek/connect/connectors.json
// (written via Task 1 — src/lib/connect/registry.ts). Surface descriptors come
// from Task 2 — src/lib/connect/descriptors.ts. Lifecycle verbs start +
// __supervise are implemented here (Task 7); stop/status are Task 8; logs Task 9.

import { spawn as _realSpawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { getDescriptor, resolveSpawn } from '../lib/connect/descriptors.js';
import {
  type TailLogDeps,
  connectorLogPath,
  listLogs,
  supervisorLogPath,
  tailLog,
} from '../lib/connect/logs.js';
import { addConnector, readConnectors, removeConnector } from '../lib/connect/registry.js';
import { readStatus, writeStatus } from '../lib/connect/status.js';
import {
  acquireSupervisorLock,
  isSupervisorRunning,
  readSupervisorLock,
} from '../lib/connect/supervisor-lock.js';
import { Supervisor, type SupervisorDeps } from '../lib/connect/supervisor.js';
import { peekHomeDir } from '../lib/peek-home.js';

const USAGE = `Usage: peek connect <subcommand> [options]

Subcommands:
  add <surface> [--name <n>] [--command <c>] [--args=<arg>] (repeatable)
                               Register a connector for a surface
  list                         List all configured connectors
  remove <name>                Remove a connector from the registry
  start                        Start the connector supervisor daemon
  stop   <name>                Stop a running connector daemon  (SP6b-2 Task 8)
  status [name]                Show connector daemon status     (SP6b-2 Task 8)
  logs   <name>                Stream connector logs            (SP6b-2 Task 9)

Known surfaces: slack

Run \`peek connect <subcommand> --help\` for subcommand-specific options.
`;

const INTERACTIVE_SETUP_GUIDANCE = `
  Next: run the connector once interactively to capture its tokens and pair it,
  then start the daemon with \`peek connect start\`.
`;

// ── cliEntryPath ────────────────────────────────────────────────────────────

/**
 * Resolve the path to this CLI's entry-point script.
 *
 * `process.argv[1]` is set by Node to the script being run when the CLI is
 * invoked directly (e.g. via `npx peek` or `node dist/index.js`).  The
 * supervisor re-invokes this exact path for `__supervise`, so it is the
 * correct first positional arg to pass to the detached spawn.
 *
 * Exported so tests can override it via the `deps` parameter of `runStart`
 * rather than monkeypatching `process.argv`.
 */
export function cliEntryPath(): string {
  return process.argv[1] ?? 'peek';
}

// ── Injectable deps for runStart ─────────────────────────────────────────────

// ── Injectable deps for runStop ──────────────────────────────────────────────

/** Injectable side-effects for `runStop` — lets tests drive the decision
 * logic without real OS signals or filesystem access. */
export interface RunStopDeps {
  /** Read the supervisor lock file — returns null if absent or malformed. */
  readLock: (lockPath: string) => { pid: number; startedAtMs: number } | null;
  /** Returns true if the process at `pid` is alive. */
  isRunning: (lockPath: string) => boolean;
  /** Send a signal to a process. */
  kill: (pid: number, signal: 'SIGTERM') => void;
  /** Sleep for `ms` milliseconds (async). */
  sleep: (ms: number) => Promise<void>;
  /** Wall-clock (for polling timeout). */
  now: () => number;
}

// ── Injectable deps for runStatus ────────────────────────────────────────────

/** Injectable side-effects for `runStatus` — lets tests drive the decision
 * logic without a real lock file or status.json. */
export interface RunStatusDeps {
  /** Read the supervisor lock file — returns null if absent or malformed. */
  readLock: (lockPath: string) => { pid: number; startedAtMs: number } | null;
  /** Returns true if the process at `pid` is alive. */
  isRunning: (lockPath: string) => boolean;
  /** Read the connector status map from status.json. */
  readStatus: () => ReturnType<typeof readStatus>;
  /** Wall-clock in milliseconds (injectable for tests). */
  now: () => number;
}

/** Injectable side-effects for `runStart` — lets tests assert the decision
 * logic without launching a real detached process. */
export interface RunStartDeps {
  /** Check whether a supervisor is already running at `lockPath`. */
  isRunning: (lockPath: string) => boolean;
  /** Read the lock info (PID) for the "already running" message. */
  readLock: (lockPath: string) => { pid: number; startedAtMs: number } | null;
  /** Spawn the detached supervisor process. Returns a value with `.unref()`. */
  spawnDetached: (
    execPath: string,
    args: string[],
    opts: { detached: true; stdio: ['ignore', number, number] },
  ) => { unref: () => void };
  /** Open (or create) the supervisor log file for append, returning a fd. */
  openLogFd: (logPath: string) => number;
  /** Resolve the path to the CLI entry point. */
  cliEntry: () => string;
}

// ── Injectable deps for runSupervise ─────────────────────────────────────────

/** Injectable side-effects for `runSupervise` — lets tests drive the decision
 * logic without touching the real lock, filesystem, or child processes. */
export interface RunSuperviseDeps {
  /** Attempt to acquire the supervisor lock at `lockPath`. */
  acquireLock: (lockPath: string) => { release: () => void } | null;
  /**
   * Build and return a Supervisor-compatible object given the connectors map
   * and real deps.  Tests inject a factory that returns a stub so `start()` +
   * `shutdown()` can be asserted without spawning real processes.
   */
  supervisorFactory: (
    connectors: ReturnType<typeof readConnectors>['connectors'],
    deps: SupervisorDeps,
  ) => { start: () => void; shutdown: () => void };
  /** Injectable signal registrar — defaults to `process.on`. */
  onSignal: (signal: string, handler: () => void) => void;
}

// ── Helpers for real (non-injected) runStart ─────────────────────────────────

function openSupervisorLogFd(logPath: string): number {
  mkdirSync(dirname(logPath), { recursive: true });
  return openSync(logPath, 'a');
}

// ── start ───────────────────────────────────────────────────────────────────

/**
 * `peek connect start` — spawn a detached supervisor process and return
 * immediately.  If a supervisor is already running (live lock file), prints its
 * PID and exits without spawning a second instance.
 *
 * All side-effecting operations are injectable via `deps` so tests can drive
 * the decision logic without launching a real detached process.
 */
export async function runStart(deps?: Partial<RunStartDeps>): Promise<number> {
  const lockPath = join(peekHomeDir(), 'connect', 'supervisor.lock');

  const isRunning = deps?.isRunning ?? ((lp: string) => isSupervisorRunning(lp));
  const readLock = deps?.readLock ?? ((lp: string) => readSupervisorLock(lp));
  const openLogFd = deps?.openLogFd ?? openSupervisorLogFd;
  const spawnDetached =
    deps?.spawnDetached ??
    ((
      execPath: string,
      args: string[],
      opts: { detached: true; stdio: ['ignore', number, number] },
    ) => _realSpawn(execPath, args, { ...opts }));
  const cliEntry = deps?.cliEntry ?? cliEntryPath;

  if (isRunning(lockPath)) {
    const info = readLock(lockPath);
    const pidPart = info !== null ? ` (pid ${info.pid})` : '';
    process.stdout.write(`peek connect: supervisor already running${pidPart}\n`);
    return 0;
  }

  const logPath = supervisorLogPath();
  const logFd = openLogFd(logPath);

  const child = spawnDetached(process.execPath, [cliEntry(), 'connect', '__supervise'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();

  process.stdout.write('peek connect: supervisor started\n');
  return 0;
}

// ── __supervise (hidden) ─────────────────────────────────────────────────────

/** Open (or create) the per-connector log file for append, returning a fd.
 * THIS is the per-connector log routing the Task-4 review flagged: the `name`
 * arg on SupervisorDeps.spawn exists precisely for this wiring. */
function openConnectorLogFd(name: string): number {
  const logPath = connectorLogPath(name);
  mkdirSync(dirname(logPath), { recursive: true });
  return openSync(logPath, 'a');
}

/** Build the real SupervisorDeps for use inside the actual daemon process. */
function buildRealDeps(): SupervisorDeps {
  return {
    spawn: (command, args, name) => {
      // Route each connector's stdout+stderr to its own log file. The `name`
      // parameter on SupervisorDeps.spawn was designed for exactly this.
      const logFd = openConnectorLogFd(name);
      // Cast to ChildLike: ChildProcess.pid is `number | undefined` in @types/node
      // whereas ChildLike.pid is `pid?: number`; they are semantically identical
      // but differ under exactOptionalPropertyTypes — the cast is safe here.
      return _realSpawn(command, args, {
        stdio: ['ignore', logFd, logFd],
        detached: false,
      }) as import('../lib/connect/supervisor.js').ChildLike;
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    resolveSpawn,
    writeStatus,
  };
}

/**
 * `peek connect __supervise` — the hidden long-running daemon entrypoint.
 *
 * Acquires the supervisor lock (exits silently on a racing double-start),
 * builds a Supervisor from the current connector registry, starts it, and
 * installs SIGTERM/SIGINT handlers to gracefully shut down.
 *
 * This subcommand is intentionally hidden from USAGE — it is only ever
 * invoked by `runStart` as a detached child process.
 *
 * All side-effecting operations are injectable via `deps` so tests can drive
 * the decision logic without acquiring a real lock or spawning processes.
 */
export async function runSupervise(deps?: Partial<RunSuperviseDeps>): Promise<number> {
  const connectDir = join(peekHomeDir(), 'connect');
  const lockPath = join(connectDir, 'supervisor.lock');

  // Ensure the connect directory exists before the lock attempt (the lock uses
  // O_EXCL which requires the parent directory to already be present).
  mkdirSync(connectDir, { recursive: true });

  const acquireLock = deps?.acquireLock ?? ((lp: string) => acquireSupervisorLock(lp));
  const supervisorFactory =
    deps?.supervisorFactory ??
    ((connectors: ReturnType<typeof readConnectors>['connectors'], realDeps: SupervisorDeps) =>
      new Supervisor(connectors, realDeps));
  const onSignal =
    deps?.onSignal ?? ((signal: string, handler: () => void) => process.on(signal, handler));

  const lock = acquireLock(lockPath);
  if (lock === null) {
    // A racing double-start: another supervisor grabbed the lock first. Exit
    // quietly — the other process is already running.
    return 0;
  }

  try {
    const { connectors } = readConnectors();
    const realDeps = buildRealDeps();
    const sup = supervisorFactory(connectors, realDeps);
    sup.start();

    const shutdown = (): void => {
      sup.shutdown();
      lock.release();
      process.exit(0);
    };

    onSignal('SIGTERM', shutdown);
    onSignal('SIGINT', shutdown);
  } catch (e) {
    lock.release();
    throw e;
  }

  // The supervisor keeps this process alive through running child processes and
  // their 'exit' listeners (via deps.setTimer → setTimeout chains).  If no
  // connectors are configured, there are no children or timers to hold the
  // event loop, so we install a keep-alive interval.  We unref() it so it does
  // not block a clean SIGTERM-triggered exit once all other handles are gone.
  const keepAlive = setInterval(() => {
    // No-op: just keeps Node's event loop alive so the daemon does not
    // immediately exit when there are no connector children yet.
  }, 2_147_483_647 /* ~24.8 days, near INT32_MAX so Node clears it correctly */);
  keepAlive.unref();

  return 0;
}

// ── stop ────────────────────────────────────────────────────────────────────

/** Max ms to wait for the supervisor to release its lock after SIGTERM. */
const STOP_TIMEOUT_MS = 5_000;
/** Polling interval when waiting for the lock to clear after SIGTERM. */
const STOP_POLL_MS = 100;

/**
 * `peek connect stop` — send SIGTERM to the running supervisor and wait for
 * it to release its lock. Idempotent: prints "not running" and returns 0 if
 * no live supervisor exists.
 *
 * All side-effecting operations are injectable via `deps` so tests can drive
 * the decision logic without real OS signals or filesystem access.
 */
export async function runStop(deps?: Partial<RunStopDeps>): Promise<number> {
  const lockPath = join(peekHomeDir(), 'connect', 'supervisor.lock');

  const readLock = deps?.readLock ?? ((lp: string) => readSupervisorLock(lp));
  const isRunning = deps?.isRunning ?? ((lp: string) => isSupervisorRunning(lp));
  const kill = deps?.kill ?? ((pid: number, signal: 'SIGTERM') => process.kill(pid, signal));
  const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps?.now ?? (() => Date.now());

  const info = readLock(lockPath);

  if (info === null || !isRunning(lockPath)) {
    process.stdout.write('peek connect: supervisor not running\n');
    return 0;
  }

  kill(info.pid, 'SIGTERM');

  // Poll until the lock clears or a timeout elapses.
  const deadline = now() + STOP_TIMEOUT_MS;
  while (isRunning(lockPath)) {
    if (now() >= deadline) {
      process.stderr.write('peek connect stop: timed out waiting for supervisor to stop\n');
      return 1;
    }
    await sleep(STOP_POLL_MS);
  }

  process.stdout.write('peek connect: supervisor stopped\n');
  return 0;
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * `peek connect status` — print the supervisor's running state and each
 * connector's per-connector status from `~/.peek/connect/status.json`.
 *
 * Prints "not running" when no live supervisor lock is found. Otherwise
 * shows a table: one row per connector with state / pid / restarts /
 * lastExitCode / nextRetryAt.
 *
 * All side-effecting operations are injectable via `deps` for tests.
 */
export async function runStatus(deps?: Partial<RunStatusDeps>): Promise<number> {
  const lockPath = join(peekHomeDir(), 'connect', 'supervisor.lock');

  const readLock = deps?.readLock ?? ((lp: string) => readSupervisorLock(lp));
  const isRunning = deps?.isRunning ?? ((lp: string) => isSupervisorRunning(lp));
  const readStatusFn = deps?.readStatus ?? readStatus;
  const now = deps?.now ?? (() => Date.now());

  if (!isRunning(lockPath)) {
    process.stdout.write('peek connect: supervisor not running\n');
    return 0;
  }

  const info = readLock(lockPath);
  const uptimeSec = info !== null ? Math.floor((now() - info.startedAtMs) / 1000) : 0;
  const pidPart = info !== null ? ` pid=${info.pid}` : '';
  process.stdout.write(`supervisor: running${pidPart} uptime=${uptimeSec}s\n`);

  const connectors = readStatusFn();
  const entries = Object.entries(connectors);

  if (entries.length === 0) {
    process.stdout.write('connectors: none\n');
    return 0;
  }

  for (const [name, cs] of entries) {
    const pidCol = cs.pid !== undefined ? ` pid=${cs.pid}` : '';
    const exitCol = cs.lastExitCode !== undefined ? ` exit=${cs.lastExitCode}` : '';
    const retryCol =
      cs.nextRetryAtMs !== undefined
        ? ` retry-in=${Math.max(0, Math.ceil((cs.nextRetryAtMs - now()) / 1000))}s`
        : '';
    process.stdout.write(
      `  ${name}: ${cs.state}${pidCol} restarts=${cs.restarts}${exitCol}${retryCol}\n`,
    );
  }

  return 0;
}

// ── logs ────────────────────────────────────────────────────────────────────

/** Injectable side-effects for `runLogs` — lets tests drive the decision
 * logic without real fs reads or file watchers. */
export type RunLogsDeps = Partial<TailLogDeps>;

const LOGS_FLAGS = {
  follow: { type: 'boolean' },
  lines: { type: 'string' },
  help: { type: 'boolean' },
} as const;

/**
 * `peek connect logs [name] [--follow] [--lines N]` — print (or tail -f) a
 * per-connector log file.
 *
 * Without a name: lists the connector names for which log files exist, with
 * guidance on how to view one.
 *
 * With a name: delegates to `tailLog` which handles both the one-shot tail
 * (default) and the streaming `--follow` mode.
 *
 * All side-effecting operations are injectable via `deps`.
 */
export async function runLogs(rest: string[], deps?: RunLogsDeps): Promise<number> {
  let values: { follow?: boolean; lines?: string; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: rest,
      options: LOGS_FLAGS,
      allowPositionals: true,
    }));
  } catch (err) {
    process.stderr.write(
      `peek connect logs: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  if (values.help === true) {
    process.stdout.write('Usage: peek connect logs [name] [--follow] [--lines N]\n');
    return 0;
  }

  const name = positionals[0];

  if (name === undefined) {
    // No name: list available connector logs.
    const available = listLogs();
    if (available.length === 0) {
      process.stdout.write(
        'peek connect logs: no connector logs yet — start the daemon with `peek connect start`\n',
      );
    } else {
      process.stdout.write('Available connector logs:\n');
      for (const n of available) {
        process.stdout.write(`  ${n}\n`);
      }
      process.stdout.write('\nRun `peek connect logs <name>` to view a log.\n');
    }
    return 0;
  }

  const linesRaw = values.lines;
  let lines: number | undefined;
  if (linesRaw !== undefined) {
    const parsed = Number.parseInt(linesRaw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      process.stderr.write(
        `peek connect logs: --lines must be a positive integer, got '${linesRaw}'\n`,
      );
      return 1;
    }
    lines = parsed;
  }

  await tailLog(
    name,
    {
      ...(values.follow !== undefined ? { follow: values.follow } : {}),
      ...(lines !== undefined ? { lines } : {}),
    },
    deps,
  );

  return 0;
}

export async function runConnect(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return sub === undefined ? 1 : 0;
  }

  try {
    switch (sub) {
      case 'add':
        return runAdd(rest);
      case 'list':
        return runList();
      case 'remove':
        return runRemove(rest);
      case 'start':
        return runStart();
      case '__supervise':
        // Hidden subcommand — not shown in USAGE. Invoked by `runStart` as
        // the detached daemon entrypoint.
        return runSupervise();
      case 'stop':
        return runStop();
      case 'status':
        return runStatus();
      case 'logs':
        return runLogs(rest);
      default:
        process.stderr.write(`peek connect: unknown subcommand '${sub}'\n\n`);
        process.stdout.write(USAGE);
        return 1;
    }
  } catch (err) {
    process.stderr.write(`peek connect: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

// ── add ────────────────────────────────────────────────────────────────────

const ADD_FLAGS = {
  name: { type: 'string' },
  command: { type: 'string' },
  args: { type: 'string', multiple: true },
  help: { type: 'boolean' },
} as const;

function runAdd(rest: string[]): number {
  const surface = rest[0];
  if (surface === undefined || surface.startsWith('-')) {
    process.stderr.write('peek connect add: missing <surface> argument\n');
    process.stdout.write(USAGE);
    return 1;
  }

  let values: {
    name?: string;
    command?: string;
    args?: string[];
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({ args: rest.slice(1), options: ADD_FLAGS, allowPositionals: false }));
  } catch (err) {
    process.stderr.write(`peek connect add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const descriptor = getDescriptor(surface);
  if (descriptor === undefined && values.command === undefined) {
    process.stderr.write(
      `peek connect add: unknown surface '${surface}' — pass --command to use a custom connector binary\n`,
    );
    return 1;
  }

  const name = values.name ?? surface;

  // Build entry conditionally to satisfy exactOptionalPropertyTypes.
  const entry = {
    surface,
    enabled: true,
    ...(values.command !== undefined ? { command: values.command } : {}),
    ...(values.args !== undefined && values.args.length > 0 ? { args: values.args } : {}),
  };

  addConnector(name, entry);

  process.stdout.write(`Connector '${name}' (surface: ${surface}) added to the registry.\n`);
  process.stdout.write(INTERACTIVE_SETUP_GUIDANCE);
  return 0;
}

// ── list ───────────────────────────────────────────────────────────────────

function runList(): number {
  const file = readConnectors();
  const entries = Object.entries(file.connectors);

  if (entries.length === 0) {
    process.stdout.write('no connectors configured\n');
    return 0;
  }

  for (const [name, entry] of entries) {
    const enabledLabel = entry.enabled ? 'enabled' : 'disabled';
    const commandPart = entry.command !== undefined ? `  command: ${entry.command}` : '';
    process.stdout.write(`${name}  ${entry.surface}  ${enabledLabel}${commandPart}\n`);
  }
  return 0;
}

// ── remove ─────────────────────────────────────────────────────────────────

function runRemove(rest: string[]): number {
  const name = rest[0];
  if (name === undefined) {
    process.stderr.write('peek connect remove: missing <name> argument\n');
    return 1;
  }

  removeConnector(name);
  process.stdout.write(`Connector '${name}' removed from the registry.\n`);
  return 0;
}
