// Tests for `peek connect <add|list|remove|start|__supervise>` verbs + routing.
// Registry path injection: each test passes a tmp connectors.json path via
// PEEK_HOME so peekHomeDir() resolves to a temp directory. This mirrors the
// pattern used in sessions.import.test.ts and lib/import-session.test.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { mkdirSync as fsMkdirSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../index.js';
import { readConnectors } from '../lib/connect/registry.js';
import { runConnect, runLogs, runStart, runStatus, runStop, runSupervise } from './connect.js';

let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-connect-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});

afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── helpers ────────────────────────────────────────────────────────────────

function silenced(): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    out.push(typeof s === 'string' ? s : s.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    err.push(typeof s === 'string' ? s : s.toString());
    return true;
  });
  return { out, err };
}

// ── add ────────────────────────────────────────────────────────────────────

describe('peek connect add', () => {
  it('adds a known surface (slack) and returns 0', async () => {
    const { out } = silenced();
    const code = await runConnect(['add', 'slack']);
    expect(code).toBe(0);

    // Default name is surface name when --name omitted
    const file = readConnectors();
    const names = Object.keys(file.connectors);
    expect(names).toHaveLength(1);
    const entry = file.connectors[names[0] as string];
    expect(entry?.surface).toBe('slack');
    expect(entry?.enabled).toBe(true);

    // Prints the interactive-setup guidance
    const combined = out.join('');
    expect(combined).toMatch(/interactively/);
    expect(combined).toMatch(/peek connect start/);
  });

  it('supports --name override', async () => {
    silenced();
    const code = await runConnect(['add', 'slack', '--name', 'my-slack']);
    expect(code).toBe(0);

    const file = readConnectors();
    expect(Object.keys(file.connectors)).toContain('my-slack');
  });

  it('rejects unknown surface with no --command (returns 1)', async () => {
    const { err } = silenced();
    const code = await runConnect(['add', 'unknown-surface-xyz']);
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/unknown-surface-xyz/);
  });

  it('accepts unknown surface when --command is provided', async () => {
    silenced();
    const code = await runConnect(['add', 'custom', '--command', 'my-connector-bin']);
    expect(code).toBe(0);

    const file = readConnectors();
    const entry = file.connectors.custom;
    expect(entry?.command).toBe('my-connector-bin');
  });

  it('stores --args when provided', async () => {
    silenced();
    // parseArgs requires flag-like arg values to use = syntax to avoid ambiguity
    const code = await runConnect(['add', 'slack', '--args=--token', '--args=xoxb-test']);
    expect(code).toBe(0);

    const file = readConnectors();
    const entry = Object.values(file.connectors)[0];
    expect(entry?.args).toEqual(['--token', 'xoxb-test']);
  });
});

// ── list ───────────────────────────────────────────────────────────────────

describe('peek connect list', () => {
  it('prints "no connectors configured" when empty, returns 0', async () => {
    const { out } = silenced();
    const code = await runConnect(['list']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/no connectors configured/);
  });

  it('prints each connector name + surface + enabled, returns 0', async () => {
    const { out } = silenced();
    await runConnect(['add', 'slack']);
    vi.restoreAllMocks();

    const { out: out2 } = silenced();
    const code = await runConnect(['list']);
    expect(code).toBe(0);
    const combined = out2.join('');
    expect(combined).toMatch(/slack/);
    expect(combined).toMatch(/enabled/);
    // suppress unused-variable warning for `out`
    void out;
  });
});

// ── remove ─────────────────────────────────────────────────────────────────

describe('peek connect remove', () => {
  it('removes an existing connector and returns 0', async () => {
    silenced();
    await runConnect(['add', 'slack']);
    vi.restoreAllMocks();

    silenced();
    const code = await runConnect(['remove', 'slack']);
    expect(code).toBe(0);

    const file = readConnectors();
    expect(Object.keys(file.connectors)).toHaveLength(0);
  });

  it('no-ops gracefully if name absent, returns 0', async () => {
    silenced();
    const code = await runConnect(['remove', 'nonexistent']);
    expect(code).toBe(0);
  });
});

// ── start (Task 7) ─────────────────────────────────────────────────────────

describe('peek connect start', () => {
  it('prints "already running" and returns 0 when supervisor is live — no spawn', async () => {
    const { out } = silenced();
    const spawnCalled: unknown[] = [];

    const code = await runStart({
      isRunning: () => true,
      readLock: () => ({ pid: 42, startedAtMs: Date.now() }),
      spawnDetached: (...args) => {
        spawnCalled.push(args);
        return { unref: () => {} };
      },
      // openLogFd should not be called — still provide one to catch accidental calls
      openLogFd: () => {
        throw new Error('openLogFd must not be called when already running');
      },
      cliEntry: () => '/usr/local/bin/peek',
    });

    expect(code).toBe(0);
    expect(spawnCalled).toHaveLength(0);
    const combined = out.join('');
    expect(combined).toMatch(/already running/);
    expect(combined).toMatch(/42/); // PID included
  });

  it('spawns detached __supervise with correct args and calls unref, returns 0', async () => {
    const { out } = silenced();

    const spawnCalls: Array<{
      execPath: string;
      args: string[];
      opts: { detached: boolean; stdio: unknown[] };
    }> = [];
    let unrefCalled = false;

    const code = await runStart({
      isRunning: () => false,
      readLock: () => null,
      openLogFd: () => 99, // fake fd
      spawnDetached: (execPath, args, opts) => {
        spawnCalls.push({ execPath, args, opts });
        return {
          unref: () => {
            unrefCalled = true;
          },
        };
      },
      cliEntry: () => '/path/to/peek/dist/index.js',
    });

    expect(code).toBe(0);
    expect(spawnCalls).toHaveLength(1);

    const call = spawnCalls[0];
    // The detached spawn must use the correct process.execPath + [cliEntry, 'connect', '__supervise']
    expect(call?.execPath).toBe(process.execPath);
    expect(call?.args).toEqual(['/path/to/peek/dist/index.js', 'connect', '__supervise']);
    expect(call?.opts.detached).toBe(true);
    expect(call?.opts.stdio[0]).toBe('ignore');
    // stdio[1] and stdio[2] should be the fake fd
    expect(call?.opts.stdio[1]).toBe(99);
    expect(call?.opts.stdio[2]).toBe(99);

    expect(unrefCalled).toBe(true);
    expect(out.join('')).toMatch(/started/);
  });

  it('routes through runConnect correctly (start → runStart)', async () => {
    // Verify the routing layer calls runStart by checking that a running-check
    // happens.  We inject isRunning→true via process env to avoid a real lock read.
    // Since runConnect calls runStart() with no injected deps, we need to mock the
    // real isSupervisorRunning. For routing, just ensure the response is 0 and
    // the output says "already running" or "started" (not the old stub message).
    //
    // We spy on process.stdout to check the output is NOT the old stub text.
    const { out } = silenced();

    // Make isSupervisorRunning return true by writing a fake lock file.
    // This exercises the real code path through runConnect.
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(home, 'connect'), { recursive: true });
    writeFileSync(
      join(home, 'connect', 'supervisor.lock'),
      JSON.stringify({ pid: process.pid, startedAtMs: Date.now() }),
    );

    const code = await runConnect(['start']);
    expect(code).toBe(0);
    // Should print "already running" (not the old "not implemented yet" stub)
    expect(out.join('')).toMatch(/already running/);
    expect(out.join('')).not.toMatch(/not implemented yet/);
  });
});

// ── __supervise (Task 7) ───────────────────────────────────────────────────

describe('peek connect __supervise', () => {
  it('returns 0 immediately when lock cannot be acquired (racing double-start)', async () => {
    silenced();
    let factoryCalled = false;

    const code = await runSupervise({
      acquireLock: () => null, // lock already held by another process
      supervisorFactory: () => {
        factoryCalled = true;
        return { start: () => {}, shutdown: () => {} };
      },
      onSignal: () => {},
    });

    expect(code).toBe(0);
    expect(factoryCalled).toBe(false);
  });

  it('acquires lock → builds supervisor → calls start() → registers SIGTERM+SIGINT', async () => {
    silenced();

    let releaseCalled = false;
    const fakeLock = {
      release: () => {
        releaseCalled = true;
      },
    };

    let startCalled = false;
    let shutdownCalled = false;
    const fakeSup = {
      start: () => {
        startCalled = true;
      },
      shutdown: () => {
        shutdownCalled = true;
      },
    };

    let factoryReceivedConnectors: unknown = null;
    const registeredSignals: string[] = [];
    const signalHandlers: Array<() => void> = [];

    const code = await runSupervise({
      acquireLock: () => fakeLock,
      supervisorFactory: (connectors, _deps) => {
        factoryReceivedConnectors = connectors;
        return fakeSup;
      },
      onSignal: (signal, handler) => {
        registeredSignals.push(signal);
        signalHandlers.push(handler);
      },
    });

    expect(code).toBe(0);
    expect(startCalled).toBe(true);

    // Factory was called with the connectors map from the (empty) registry
    expect(factoryReceivedConnectors).toEqual({});

    // Both SIGTERM and SIGINT handlers were registered
    expect(registeredSignals).toContain('SIGTERM');
    expect(registeredSignals).toContain('SIGINT');

    // Simulate SIGTERM: shutdown() + release() should be called
    const sigtermHandler = signalHandlers[registeredSignals.indexOf('SIGTERM')];
    // Don't actually call it (it calls process.exit) — just verify they are registered
    expect(typeof sigtermHandler).toBe('function');

    // shutdown and release not yet called (signal not fired)
    expect(shutdownCalled).toBe(false);
    expect(releaseCalled).toBe(false);
  });

  it('routes through runConnect correctly (__supervise → runSupervise)', async () => {
    const { out } = silenced();

    // runConnect(['__supervise']) calls runSupervise() with no deps.
    // acquireSupervisorLock will attempt a real lock; since PEEK_HOME is a temp
    // dir the lock will succeed.  We just verify the exit is 0 (not a stub response).
    const code = await runConnect(['__supervise']);
    expect(code).toBe(0);
    // Should NOT print the old "not implemented yet" stub message
    expect(out.join('')).not.toMatch(/not implemented yet/);
  });
});

// ── stop (Task 8) ──────────────────────────────────────────────────────────

describe('peek connect stop', () => {
  it('prints "not running" and returns 0 when no lock exists', async () => {
    const { out } = silenced();
    const code = await runStop({
      readLock: () => null,
      isRunning: () => false,
      kill: () => {
        throw new Error('kill must not be called');
      },
      sleep: async () => {},
      now: () => Date.now(),
    });
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/not running/);
  });

  it('prints "not running" and returns 0 when lock exists but pid is dead', async () => {
    const { out } = silenced();
    const code = await runStop({
      readLock: () => ({ pid: 99999, startedAtMs: Date.now() }),
      isRunning: () => false,
      kill: () => {
        throw new Error('kill must not be called');
      },
      sleep: async () => {},
      now: () => Date.now(),
    });
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/not running/);
  });

  it('kills the pid with SIGTERM, polls until lock clears, prints "stopped", returns 0', async () => {
    const { out } = silenced();
    const killCalls: Array<{ pid: number; signal: string }> = [];

    // isRunning: first call (before kill) = true; poll round 1 = false (clears immediately)
    let isRunningCallCount = 0;
    const isRunning = (): boolean => {
      isRunningCallCount += 1;
      return isRunningCallCount === 1; // alive on first check, gone on second
    };

    const sleepCalls: number[] = [];

    const code = await runStop({
      readLock: () => ({ pid: 1234, startedAtMs: Date.now() - 5000 }),
      isRunning,
      kill: (pid, signal) => {
        killCalls.push({ pid, signal });
      },
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      now: () => Date.now(),
    });

    expect(code).toBe(0);
    expect(killCalls).toHaveLength(1);
    expect(killCalls[0]).toEqual({ pid: 1234, signal: 'SIGTERM' });
    // Polled once (lock cleared on first poll); sleep may or may not have been
    // called depending on whether the lock already cleared at poll time.
    expect(out.join('')).toMatch(/stopped/);
  });

  it('routes through runConnect correctly (stop → runStop)', async () => {
    // Supervisor not running (no lock file in temp PEEK_HOME).
    const { out } = silenced();
    const code = await runConnect(['stop']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/not running/);
    expect(out.join('')).not.toMatch(/not implemented yet/);
  });
});

// ── status (Task 8) ────────────────────────────────────────────────────────

describe('peek connect status', () => {
  it('prints "not running" and returns 0 when no live supervisor', async () => {
    const { out } = silenced();
    const code = await runStatus({
      readLock: () => null,
      isRunning: () => false,
      readStatus: () => ({}),
      now: () => Date.now(),
    });
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/not running/);
  });

  it('prints supervisor pid + uptime + connector rows when running', async () => {
    const { out } = silenced();
    const fixedNow = 1_700_000_010_000; // 10 seconds after start
    const startedAtMs = fixedNow - 10_000;

    const code = await runStatus({
      readLock: () => ({ pid: 42, startedAtMs }),
      isRunning: () => true,
      readStatus: () => ({
        slack: { state: 'running', pid: 101, restarts: 0 },
      }),
      now: () => fixedNow,
    });

    expect(code).toBe(0);
    const combined = out.join('');
    expect(combined).toMatch(/pid=42/);
    expect(combined).toMatch(/uptime=10s/);
    expect(combined).toMatch(/slack/);
    expect(combined).toMatch(/running/);
    expect(combined).toMatch(/pid=101/);
    expect(combined).toMatch(/restarts=0/);
  });

  it('prints "connectors: none" when no connectors are registered in status.json', async () => {
    const { out } = silenced();
    const code = await runStatus({
      readLock: () => ({ pid: 5, startedAtMs: Date.now() }),
      isRunning: () => true,
      readStatus: () => ({}),
      now: () => Date.now(),
    });
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/none/);
  });

  it('shows backing-off connector with retry countdown', async () => {
    const { out } = silenced();
    const fixedNow = 1_700_000_000_000;
    const code = await runStatus({
      readLock: () => ({ pid: 7, startedAtMs: fixedNow - 3000 }),
      isRunning: () => true,
      readStatus: () => ({
        slack: {
          state: 'backing-off',
          restarts: 2,
          lastExitCode: 1,
          nextRetryAtMs: fixedNow + 5000,
        },
      }),
      now: () => fixedNow,
    });
    expect(code).toBe(0);
    const combined = out.join('');
    expect(combined).toMatch(/backing-off/);
    expect(combined).toMatch(/exit=1/);
    expect(combined).toMatch(/retry-in=5s/);
  });

  it('routes through runConnect correctly (status → runStatus)', async () => {
    // No live supervisor in temp PEEK_HOME.
    const { out } = silenced();
    const code = await runConnect(['status']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/not running/);
    expect(out.join('')).not.toMatch(/not implemented yet/);
  });
});

// ── logs (Task 9) ──────────────────────────────────────────────────────────

describe('peek connect logs', () => {
  it('with no name, lists available connector logs (returns 0)', async () => {
    // Seed a couple of log files so listLogs() can find them.
    const logsDir = join(home, 'connect', 'logs');
    fsMkdirSync(logsDir, { recursive: true });
    fsWriteFileSync(join(logsDir, 'peek-slack.log'), '');
    fsWriteFileSync(join(logsDir, 'peek-discord.log'), '');

    const { out } = silenced();
    const code = await runConnect(['logs']);
    expect(code).toBe(0);
    const combined = out.join('');
    expect(combined).toMatch(/peek-slack/);
    expect(combined).toMatch(/peek-discord/);
  });

  it('with no name and no log files, prints guidance (returns 0)', async () => {
    const { out } = silenced();
    const code = await runConnect(['logs']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/no connector logs yet/);
  });

  it('calls tailLog with the correct connector name (no-follow)', async () => {
    const content = 'line1\nline2\nline3\n';
    const written: string[] = [];

    const code = await runLogs(['peek-slack'], {
      readFile: async (_p: string) => content,
      watch: () => {
        throw new Error('watch must not be called');
      },
      stdout: {
        write: (s: string) => {
          written.push(s);
          return true;
        },
      },
    });

    expect(code).toBe(0);
    expect(written.join('')).toContain('line3');
  });

  it('calls tailLog with --follow flag and streams chunks via injected watcher — promise stays PENDING until close', async () => {
    const content = 'line1\nline2\n';
    const written: string[] = [];

    let emitChunk: ((chunk: Buffer) => void) | undefined;
    // Fake watcher that implements the full on('close') / close() lifecycle.
    const closeListeners: Array<() => void> = [];
    const fakeWatcher = {
      on(event: string, cb: (() => void) | ((chunk: Buffer) => void)) {
        if (event === 'close') closeListeners.push(cb as () => void);
        return fakeWatcher;
      },
      close() {
        for (const fn of closeListeners) fn();
      },
    };

    const tailPromise = runLogs(['peek-slack', '--follow'], {
      readFile: async (_p: string) => content,
      watch: (_path: string, _startPos: number, onData: (chunk: Buffer) => void) => {
        emitChunk = onData;
        return fakeWatcher;
      },
      stdout: {
        write: (s: string) => {
          written.push(s);
          return true;
        },
      },
    });

    // Give the initial tail a tick to write existing lines.
    await Promise.resolve();
    await Promise.resolve();

    // The promise must still be PENDING at this point.
    let resolved = false;
    void tailPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Emit an appended chunk — it must reach stdout.
    emitChunk?.(Buffer.from('line3\n'));
    await Promise.resolve();

    // Close the watcher — the promise must now settle.
    fakeWatcher.close();
    await tailPromise;

    const combined = written.join('');
    expect(combined).toContain('line1');
    expect(combined).toContain('line3');
    expect(resolved).toBe(true);
  });

  it('returns 1 and prints error when --lines is not a valid positive integer', async () => {
    const { err } = silenced();
    const code = await runLogs(['peek-slack', '--lines', 'foo']);
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/--lines must be a positive integer/);
  });

  it('returns 1 and prints error when --lines is zero', async () => {
    const { err } = silenced();
    const code = await runLogs(['peek-slack', '--lines', '0']);
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/--lines must be a positive integer/);
  });

  it('routes through runConnect correctly (logs → runLogs)', async () => {
    const { out } = silenced();
    const code = await runConnect(['logs']);
    expect(code).toBe(0);
    // Should NOT print the old "not implemented yet" stub message
    expect(out.join('')).not.toMatch(/not implemented yet/);
  });
});

// ── unknown sub + help ─────────────────────────────────────────────────────

describe('peek connect unknown / help', () => {
  it('unknown subcommand prints usage and returns 1', async () => {
    const { out, err } = silenced();
    const code = await runConnect(['definitely-not-a-verb']);
    expect(code).toBe(1);
    // usage appears on stdout or stderr
    const combined = out.join('') + err.join('');
    expect(combined).toMatch(/peek connect/);
  });

  it('no subcommand prints usage and returns 1', async () => {
    const { out } = silenced();
    const code = await runConnect([]);
    expect(code).toBe(1);
    expect(out.join('')).toMatch(/peek connect/);
  });

  it('--help / help returns 0', async () => {
    const { out } = silenced();
    const code = await runConnect(['help']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/peek connect/);
  });
});

// ── top-level routing ──────────────────────────────────────────────────────

describe('run() routing', () => {
  it('routes `connect list` to runConnect', async () => {
    const { out } = silenced();
    const code = await run(['connect', 'list']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/no connectors configured/);
  });

  it('peek connect appears in top-level help', async () => {
    const { out } = silenced();
    await run(['--help']);
    expect(out.join('')).toMatch(/connect/);
  });
});
