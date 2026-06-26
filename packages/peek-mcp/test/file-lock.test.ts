import { closeSync, existsSync, mkdtempSync, openSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withFileLock } from '../src/native-host/file-lock.js';

let dir: string;
let lockPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-lock-'));
  lockPath = join(dir, 'audit.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('withFileLock', () => {
  it('runs fn, returns its value, and removes the lock afterward', () => {
    const out = withFileLock(lockPath, () => 42);
    expect(out).toBe(42);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('releases the lock even if fn throws', () => {
    expect(() =>
      withFileLock(lockPath, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(lockPath)).toBe(false);
  });

  it('times out when a fresh lock is held by someone else', () => {
    const fd = openSync(lockPath, 'wx'); // simulate another holder
    try {
      expect(() =>
        withFileLock(lockPath, () => 1, { maxWaitMs: 60, retryMs: 10, staleMs: 10_000 }),
      ).toThrow(/lock/i);
    } finally {
      closeSync(fd);
    }
  });

  it('takes over a stale lock', () => {
    const fd = openSync(lockPath, 'wx');
    closeSync(fd);
    const old = new Date(Date.now() - 60_000); // 60s ago
    utimesSync(lockPath, old, old);
    const out = withFileLock(lockPath, () => 'ok', {
      maxWaitMs: 500,
      retryMs: 10,
      staleMs: 10_000,
    });
    expect(out).toBe('ok');
    expect(existsSync(lockPath)).toBe(false);
  });
});
