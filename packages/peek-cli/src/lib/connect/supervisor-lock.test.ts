// Tests for the long-held single-instance supervisor lock.
// All fs operations use tmp paths under os.tmpdir(); pidAlive is injected.

import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireSupervisorLock,
  isSupervisorRunning,
  readSupervisorLock,
} from './supervisor-lock.js';

let lockPath: string;
let counter = 0;

beforeEach(() => {
  counter += 1;
  lockPath = join(tmpdir(), `peek-supervisor-lock-test-${process.pid}-${counter}.lock`);
});

afterEach(() => {
  try {
    rmSync(lockPath);
  } catch {
    /* already gone */
  }
});

// ── acquireSupervisorLock ──────────────────────────────────────────────────

describe('acquireSupervisorLock', () => {
  it('returns a releaser on a fresh path and writes {pid,startedAtMs}', () => {
    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    const info = readSupervisorLock(lockPath);
    expect(info).not.toBeNull();
    if (info === null) return;

    expect(info.pid).toBe(process.pid);
    expect(typeof info.startedAtMs).toBe('number');
    expect(info.startedAtMs).toBeGreaterThan(0);

    result.release();
  });

  it('returns null when a second acquire is attempted while the lock is held (pidAlive → true)', () => {
    const alwaysAlive = () => true;

    const first = acquireSupervisorLock(lockPath, { pidAlive: alwaysAlive });
    expect(first).not.toBeNull();
    if (first === null) return;

    const second = acquireSupervisorLock(lockPath, { pidAlive: alwaysAlive });
    expect(second).toBeNull();

    first.release();
  });

  it('takes over a lock with a dead PID (pidAlive → false)', () => {
    // Write a fake stale lock file with a non-existent PID.
    writeFileSync(lockPath, JSON.stringify({ pid: 99999999, startedAtMs: Date.now() - 60_000 }));

    const result = acquireSupervisorLock(lockPath, { pidAlive: () => false });
    expect(result).not.toBeNull();
    if (result === null) return;

    const info = readSupervisorLock(lockPath);
    expect(info).not.toBeNull();
    if (info === null) return;

    expect(info.pid).toBe(process.pid);

    result.release();
  });

  it('takes over a lock with a malformed (unparseable) lock file', () => {
    writeFileSync(lockPath, 'not-valid-json!!!');

    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    const info = readSupervisorLock(lockPath);
    expect(info).not.toBeNull();
    if (info === null) return;

    expect(info.pid).toBe(process.pid);

    result.release();
  });
});

// ── release ────────────────────────────────────────────────────────────────

describe('release', () => {
  it('removes the lock file', () => {
    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    result.release();

    expect(readSupervisorLock(lockPath)).toBeNull();
  });

  it('is idempotent — a second release does not throw', () => {
    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    result.release();
    expect(() => result.release()).not.toThrow();
  });
});

// ── readSupervisorLock ─────────────────────────────────────────────────────

describe('readSupervisorLock', () => {
  it('returns null when the lock file does not exist', () => {
    expect(readSupervisorLock(lockPath)).toBeNull();
  });

  it('returns LockInfo when the lock file exists and is valid', () => {
    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    const info = readSupervisorLock(lockPath);
    expect(info).not.toBeNull();
    if (info === null) return;

    expect(typeof info.pid).toBe('number');
    expect(typeof info.startedAtMs).toBe('number');

    result.release();
  });

  it('returns null for a malformed lock file (never throws)', () => {
    writeFileSync(lockPath, '{bad json');
    expect(readSupervisorLock(lockPath)).toBeNull();
  });

  it('returns null for a lock file missing required fields', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 123 })); // missing startedAtMs
    expect(readSupervisorLock(lockPath)).toBeNull();
  });
});

// ── isSupervisorRunning ────────────────────────────────────────────────────

describe('isSupervisorRunning', () => {
  it('returns false when lock file does not exist', () => {
    expect(isSupervisorRunning(lockPath)).toBe(false);
  });

  it('returns true when lock exists and PID is alive (our own process)', () => {
    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    // Our own PID is always alive; no injection needed.
    expect(isSupervisorRunning(lockPath)).toBe(true);

    result.release();
  });

  it('returns false when lock exists but PID is dead', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 99999999, startedAtMs: Date.now() }));

    expect(isSupervisorRunning(lockPath, { pidAlive: () => false })).toBe(false);
  });

  it('returns false after release', () => {
    const result = acquireSupervisorLock(lockPath);
    expect(result).not.toBeNull();
    if (result === null) return;

    result.release();
    expect(isSupervisorRunning(lockPath)).toBe(false);
  });
});
