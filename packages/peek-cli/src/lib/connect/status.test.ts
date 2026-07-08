// Tests for src/lib/connect/status.ts — readStatus + writeStatus.
// PEEK_HOME is injected via the env var so peekHomeDir() resolves to a temp
// dir; file-system deps are also injected to keep each unit test hermetic.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStatus, statusPath, writeStatus } from './status.js';
import type { ConnectorStatus } from './supervisor.js';

let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-status-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});

afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

// ── statusPath ────────────────────────────────────────────────────────────

describe('statusPath()', () => {
  it('returns <PEEK_HOME>/connect/status.json', () => {
    expect(statusPath()).toBe(join(home, 'connect', 'status.json'));
  });
});

// ── readStatus ────────────────────────────────────────────────────────────

describe('readStatus()', () => {
  it('returns {} when the file is absent', () => {
    // No file written — purely the absent case.
    const result = readStatus();
    expect(result).toEqual({});
  });

  it('returns {} when the file contains malformed JSON', () => {
    const result = readStatus({
      readFile: () => '{ this is not json !!',
    });
    expect(result).toEqual({});
  });

  it('returns {} when the file contains a non-object JSON value', () => {
    const result = readStatus({
      readFile: () => '"a string"',
    });
    expect(result).toEqual({});
  });

  it('returns {} when the file contains a JSON array', () => {
    const result = readStatus({
      readFile: () => '[]',
    });
    expect(result).toEqual({});
  });

  it('skips entries with an invalid state', () => {
    const raw = JSON.stringify({ foo: { state: 'unknown-state', restarts: 0 } });
    const result = readStatus({ readFile: () => raw });
    expect(result).toEqual({});
  });

  it('skips entries missing the restarts field', () => {
    const raw = JSON.stringify({ foo: { state: 'running' } });
    const result = readStatus({ readFile: () => raw });
    expect(result).toEqual({});
  });

  it('parses a valid running entry', () => {
    const status: ConnectorStatus = { state: 'running', pid: 1234, restarts: 0 };
    const raw = JSON.stringify({ myconn: status });
    const result = readStatus({ readFile: () => raw });
    expect(result).toEqual({ myconn: status });
  });

  it('parses a valid backing-off entry with optional fields', () => {
    const status: ConnectorStatus = {
      state: 'backing-off',
      restarts: 3,
      lastExitCode: 1,
      nextRetryAtMs: 1_700_000_000_000,
    };
    const raw = JSON.stringify({ slack: status });
    const result = readStatus({ readFile: () => raw });
    expect(result).toEqual({ slack: status });
  });

  it('parses a valid stopped entry', () => {
    const status: ConnectorStatus = { state: 'stopped', restarts: 2, lastExitCode: 0 };
    const raw = JSON.stringify({ slack: status });
    const result = readStatus({ readFile: () => raw });
    expect(result).toEqual({ slack: status });
  });

  it('skips invalid entries while keeping valid ones in the same file', () => {
    const good: ConnectorStatus = { state: 'running', restarts: 0, pid: 42 };
    const raw = JSON.stringify({
      bad: { state: 'unknown', restarts: 0 },
      good,
    });
    const result = readStatus({ readFile: () => raw });
    expect(result).toEqual({ good });
  });

  it('drops pid when it is a non-numeric string in JSON', () => {
    const raw = JSON.stringify({ foo: { state: 'running', restarts: 0, pid: 'not-a-number' } });
    const result = readStatus({ readFile: () => raw });
    // Entry is valid (state + restarts present); pid is malformed → dropped.
    expect(result.foo).toBeDefined();
    expect('pid' in (result.foo ?? {})).toBe(false);
  });

  it('drops lastExitCode when it is a boolean (non-number) in JSON', () => {
    const raw = JSON.stringify({ foo: { state: 'stopped', restarts: 1, lastExitCode: true } });
    const result = readStatus({ readFile: () => raw });
    expect(result.foo).toBeDefined();
    expect('lastExitCode' in (result.foo ?? {})).toBe(false);
  });

  it('drops nextRetryAtMs when it is a string in JSON', () => {
    const raw = JSON.stringify({
      foo: { state: 'backing-off', restarts: 2, nextRetryAtMs: '1700000000000' },
    });
    const result = readStatus({ readFile: () => raw });
    expect(result.foo).toBeDefined();
    expect('nextRetryAtMs' in (result.foo ?? {})).toBe(false);
  });

  it('includes all valid optional numeric fields when they are present and correctly typed', () => {
    const raw = JSON.stringify({
      foo: { state: 'backing-off', restarts: 3, pid: 42, lastExitCode: 1, nextRetryAtMs: 9999 },
    });
    const result = readStatus({ readFile: () => raw });
    expect(result.foo?.pid).toBe(42);
    expect(result.foo?.lastExitCode).toBe(1);
    expect(result.foo?.nextRetryAtMs).toBe(9999);
  });

  it('reads back what writeStatus writes (real round-trip via PEEK_HOME)', () => {
    // Use real fs: writeStatus creates the file; readStatus reads it back.
    const snapshot: Record<string, ConnectorStatus> = {
      myconn: { state: 'running', pid: 999, restarts: 1 },
    };
    writeStatus(snapshot);
    const result = readStatus();
    expect(result).toEqual(snapshot);
  });
});

// ── writeStatus ───────────────────────────────────────────────────────────

describe('writeStatus()', () => {
  it('calls mkdir on the connect dir and atomicWrite with JSON content', () => {
    const mkdirCalls: string[] = [];
    const writeCalls: Array<{ path: string; content: string }> = [];

    const snapshot: Record<string, ConnectorStatus> = {
      slack: { state: 'running', pid: 123, restarts: 0 },
    };

    writeStatus(snapshot, {
      mkdirSync: (p) => {
        mkdirCalls.push(p);
      },
      atomicWrite: (p, c) => {
        writeCalls.push({ path: p, content: c });
      },
    });

    expect(mkdirCalls).toHaveLength(1);
    expect(writeCalls).toHaveLength(1);

    // The written path must end with connect/status.json.
    expect(writeCalls[0]?.path).toMatch(/connect[/\\]status\.json$/);

    // The content must be valid JSON encoding the snapshot.
    const parsed = JSON.parse(writeCalls[0]?.content ?? '');
    expect(parsed).toEqual(snapshot);
  });

  it('writes pretty-printed JSON (2-space indent)', () => {
    const writeCalls: Array<string> = [];
    const snapshot: Record<string, ConnectorStatus> = {
      c: { state: 'stopped', restarts: 0 },
    };
    writeStatus(snapshot, {
      mkdirSync: () => {},
      atomicWrite: (_p, c) => {
        writeCalls.push(c);
      },
    });
    // Must be indented (not minified)
    expect(writeCalls[0]).toContain('\n');
    expect(writeCalls[0]).toContain('  ');
  });
});
