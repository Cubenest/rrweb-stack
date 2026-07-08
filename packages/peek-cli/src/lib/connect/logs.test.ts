// Tests for `peek connect logs` helper utilities: connectorLogPath, tailLog,
// listLogs. All fs/watcher deps are injected so tests don't need a real
// filesystem or a live fs.watch() call.

import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setFsWatch, connectorLogPath, listLogs, supervisorLogPath, tailLog } from './logs.js';

let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-logs-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});

afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
  // Always restore the real fs.watch after any test that injects a fake.
  _setFsWatch(undefined);
});

// ── path helpers ─────────────────────────────────────────────────────────────

describe('supervisorLogPath', () => {
  it('resolves to PEEK_HOME/connect/supervisor.log', () => {
    expect(supervisorLogPath()).toBe(join(home, 'connect', 'supervisor.log'));
  });
});

describe('connectorLogPath', () => {
  it('resolves to PEEK_HOME/connect/logs/<name>.log', () => {
    expect(connectorLogPath('peek-slack')).toBe(join(home, 'connect', 'logs', 'peek-slack.log'));
  });
});

// ── listLogs ─────────────────────────────────────────────────────────────────

describe('listLogs', () => {
  it('returns empty array when logs dir does not exist', () => {
    const names = listLogs();
    expect(names).toEqual([]);
  });

  it('returns connector names (without .log extension) for each .log file present', () => {
    const logsDir = join(home, 'connect', 'logs');
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, 'peek-slack.log'), '');
    writeFileSync(join(logsDir, 'peek-discord.log'), '');
    // A non-.log file should NOT be returned
    writeFileSync(join(logsDir, 'README.txt'), '');

    const names = listLogs().sort();
    expect(names).toEqual(['peek-discord', 'peek-slack']);
  });
});

// ── tailLog (no follow) ───────────────────────────────────────────────────────

describe('tailLog (no follow)', () => {
  it('prints "no logs yet" message when log file is absent — does NOT throw', async () => {
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    await tailLog(
      'peek-slack',
      { follow: false },
      {
        readFile: async (_p: string) => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        watch: () => {
          throw new Error('watch must not be called in no-follow mode');
        },
        stdout: fakeStdout,
      },
    );

    expect(written.join('')).toMatch(/no logs yet for peek-slack/);
  });

  it('prints the last N lines from a log file', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const content = `${lines.join('\n')}\n`;
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    await tailLog(
      'peek-slack',
      { follow: false, lines: 10 },
      {
        readFile: async (_p: string) => content,
        watch: () => {
          throw new Error('watch must not be called in no-follow mode');
        },
        stdout: fakeStdout,
      },
    );

    const combined = written.join('');
    // Only the last 10 lines should appear
    expect(combined).toContain('line 91');
    expect(combined).toContain('line 100');
    expect(combined).not.toContain('line 90');
  });

  it('prints all lines when file has fewer lines than the requested count', async () => {
    const content = 'line 1\nline 2\nline 3\n';
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    await tailLog(
      'peek-slack',
      { follow: false, lines: 50 },
      {
        readFile: async (_p: string) => content,
        watch: () => {
          throw new Error('watch must not be called in no-follow mode');
        },
        stdout: fakeStdout,
      },
    );

    const combined = written.join('');
    expect(combined).toContain('line 1');
    expect(combined).toContain('line 3');
  });

  it('uses default 50 lines when lines is not specified', async () => {
    // 60 lines: only last 50 should be shown
    const lines = Array.from({ length: 60 }, (_, i) => `L${i + 1}`);
    const content = `${lines.join('\n')}\n`;
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    await tailLog(
      'peek-slack',
      { follow: false },
      {
        readFile: async (_p: string) => content,
        watch: () => {
          throw new Error('watch must not be called');
        },
        stdout: fakeStdout,
      },
    );

    const combined = written.join('');
    expect(combined).toContain('L11'); // line 11 = first of last 50 (60-50+1)
    expect(combined).toContain('L60');
    expect(combined).not.toContain('L10\n');
  });
});

// ── tailLog (follow) ─────────────────────────────────────────────────────────

describe('tailLog (follow)', () => {
  it('prints tail lines then streams bytes from injected watcher — promise stays PENDING until close', async () => {
    const content = 'line 1\nline 2\n';
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    // Fake watcher: captures onData (passed as watchFn arg) and fires close
    // listeners registered via .on('close', cb).
    let capturedOnData: ((chunk: Buffer) => void) | undefined;
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

    const tailPromise = tailLog(
      'peek-slack',
      { follow: true, lines: 2 },
      {
        readFile: async (_p: string) => content,
        watch: (_p: string, _startPos: number, onData: (chunk: Buffer) => void) => {
          capturedOnData = onData;
          return fakeWatcher;
        },
        stdout: fakeStdout,
      },
    );

    // Give the initial tail a tick to write the existing lines.
    await Promise.resolve();
    await Promise.resolve();

    // (a) The promise must still be PENDING — race it against an already-resolved
    // sentinel; the sentinel should win.
    let tailResolved = false;
    void tailPromise.then(() => {
      tailResolved = true;
    });
    await Promise.resolve();
    expect(tailResolved).toBe(false);

    // (b) Simulate a newly appended chunk — it must reach stdout.
    capturedOnData?.(Buffer.from('line 3\n'));
    await Promise.resolve();

    // (c) Close the watcher — the promise must now settle.
    fakeWatcher.close();
    await tailPromise;

    const combined = written.join('');
    expect(combined).toContain('line 1');
    expect(combined).toContain('line 2');
    expect(combined).toContain('line 3');
    expect(tailResolved).toBe(true);
  });

  it('does NOT throw when file is absent in follow mode — prints "no logs yet" then watches', async () => {
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    let watchCalled = false;
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

    const tailPromise = tailLog(
      'peek-slack',
      { follow: true },
      {
        readFile: async (_p: string) => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        watch: (_p: string, _startPos: number, _onData: (chunk: Buffer) => void) => {
          watchCalled = true;
          return fakeWatcher;
        },
        stdout: fakeStdout,
      },
    );

    await Promise.resolve();
    await Promise.resolve();
    fakeWatcher.close();
    await tailPromise;

    expect(written.join('')).toMatch(/no logs yet for peek-slack/);
    expect(watchCalled).toBe(true);
  });

  // FIX D (guard proof): these two tests verify the default watchFn's error
  // handling by injecting a fake fs.watch via the _setFsWatch seam. Unlike the
  // outer `watch` dep on TailLogDeps (which replaces the ENTIRE watchFn and
  // causes a tautology), _setFsWatch only replaces the underlying fs.watch call
  // INSIDE the default watchFn — so the FIX-D try/catch + on('error') code
  // actually runs.  Both tests FAIL when FIX-D is reverted and PASS with it.

  it('default-watcher: synchronous fs.watch throw is caught — process does not crash, "no logs yet" printed, promise stays pending', async () => {
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    // Simulate Linux behaviour: fs.watch throws synchronously on a missing path.
    // The _setFsWatch seam injects this throw INTO the default watchFn so the
    // real try/catch (FIX-D path A) is exercised — the outer `watch` dep is NOT
    // injected, so tailLog uses its default watchFn.
    // readFile is injected to throw ENOENT immediately (deterministic).
    _setFsWatch((_path, _listener) => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    });

    const tailPromise = tailLog(
      'peek-absent-sync',
      { follow: true },
      {
        readFile: async (_p: string) => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        stdout: fakeStdout,
      },
    );

    // Give the async readFile a couple of ticks to settle (it rejects immediately).
    await Promise.resolve();
    await Promise.resolve();

    // The promise must still be PENDING — the no-op watcher from the catch block
    // is alive; only close() will fire the 'close' listener.
    let tailResolved = false;
    void tailPromise.then(() => {
      tailResolved = true;
    });
    await Promise.resolve();
    expect(tailResolved).toBe(false);

    // 'no logs yet' was printed (absent-file path taken before watchFn called).
    expect(written.join('')).toMatch(/no logs yet for peek-absent-sync/);
  });

  it('default-watcher: async fs.watch "error" event is swallowed — process does not crash, "no logs yet" printed, promise stays pending', async () => {
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    // Simulate macOS/Windows behaviour: fs.watch returns a watcher but emits an
    // async 'error' event (no synchronous throw). The _setFsWatch seam returns
    // a fake FSWatcher-like EventEmitter so the real on('error') handler
    // (FIX-D path B) is exercised.
    // readFile is injected to throw ENOENT immediately (deterministic).
    let fakeWatcherEmitter: EventEmitter | undefined;
    _setFsWatch((_path, _listener) => {
      fakeWatcherEmitter = new EventEmitter();
      // Attach a no-op close so the returned object satisfies FSWatcher's
      // minimal interface (FSWatcher extends EventEmitter with a .close()).
      (fakeWatcherEmitter as EventEmitter & { close: () => void }).close = () => {};
      return fakeWatcherEmitter as ReturnType<typeof import('node:fs').watch>;
    });

    const tailPromise = tailLog(
      'peek-absent-async',
      { follow: true },
      {
        readFile: async (_p: string) => {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        stdout: fakeStdout,
      },
    );

    await Promise.resolve();
    await Promise.resolve();

    // Now emit the 'error' event that a real fs.watch would emit on a missing
    // file (async path) — must NOT cause an unhandled error / crash.
    expect(() => {
      fakeWatcherEmitter?.emit(
        'error',
        Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' }),
      );
    }).not.toThrow();

    // Promise must still be pending — error was swallowed, watcher not closed.
    let tailResolved = false;
    void tailPromise.then(() => {
      tailResolved = true;
    });
    await Promise.resolve();
    expect(tailResolved).toBe(false);

    // 'no logs yet' was printed.
    expect(written.join('')).toMatch(/no logs yet for peek-absent-async/);
  });
});
