// Tests for `peek connect logs` helper utilities: connectorLogPath, tailLog,
// listLogs. All fs/watcher deps are injected so tests don't need a real
// filesystem or a live fs.watch() call.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectorLogPath, listLogs, supervisorLogPath, tailLog } from './logs.js';

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
  it('prints tail lines then streams bytes from injected watcher', async () => {
    const content = 'line 1\nline 2\n';
    const written: string[] = [];
    const fakeStdout = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };

    // A fake watcher: capture the callback and expose `emitChunk` to the test.
    let capturedCallback: ((chunk: Buffer) => void) | undefined;
    let closed = false;
    const fakeWatcher = {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') capturedCallback = cb;
        return fakeWatcher;
      },
      close: () => {
        closed = true;
      },
    };

    // tailLog with follow=true should return a promise that resolves after we
    // manually end the stream.  We drive it from outside via the fake watcher.
    const tailPromise = tailLog(
      'peek-slack',
      { follow: true, lines: 2 },
      {
        readFile: async (_p: string) => content,
        watch: (_p: string, _startPos: number, onData: (chunk: Buffer) => void) => {
          // Capture the callback so the test can emit chunks
          capturedCallback = onData;
          return fakeWatcher as ReturnType<typeof fakeWatcher.close> extends void
            ? typeof fakeWatcher
            : never;
        },
        stdout: fakeStdout,
      },
    );

    // Give the initial tail a tick to print, then simulate an appended chunk
    await Promise.resolve();
    await Promise.resolve();

    const appended = Buffer.from('line 3\n');
    capturedCallback?.(appended);

    // Resolve the follow promise by closing the stream
    fakeWatcher.close();
    // Allow the implementation to settle (it may use a promise-based teardown)
    await tailPromise.catch(() => {});

    const combined = written.join('');
    expect(combined).toContain('line 1');
    expect(combined).toContain('line 2');
    expect(combined).toContain('line 3');
    void closed;
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
    const fakeWatcher = {
      on: (_event: string, _cb: unknown) => fakeWatcher,
      close: () => {},
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
    await tailPromise.catch(() => {});

    expect(written.join('')).toMatch(/no logs yet for peek-slack/);
    expect(watchCalled).toBe(true);
  });
});
