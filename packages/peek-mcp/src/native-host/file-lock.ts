import { randomBytes } from 'node:crypto';
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';

export interface LockOptions {
  /** Max time to wait for the lock before throwing. */
  maxWaitMs?: number;
  /** Poll interval while waiting. */
  retryMs?: number;
  /** A lock whose file mtime is older than this is considered abandoned and stolen. */
  staleMs?: number;
}

const DEFAULTS: Required<LockOptions> = { maxWaitMs: 5_000, retryMs: 25, staleMs: 10_000 };

/** Synchronous sleep without spinning the CPU (Node 22 has SharedArrayBuffer). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire an exclusive advisory lock at `lockPath`, run `fn`, release.
 * The lock is an O_EXCL file; a stale lock (older than staleMs) is taken over.
 */
export function withFileLock<T>(lockPath: string, fn: () => T, options: LockOptions = {}): T {
  const { maxWaitMs, retryMs, staleMs } = { ...DEFAULTS, ...options };
  const deadline = Date.now() + maxWaitMs;
  const { fd, token } = acquireLock(lockPath, deadline, retryMs, staleMs, maxWaitMs);
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      // Only remove the lock if we still own it. If our critical section ran
      // past staleMs, another process may have stolen the lock as stale and
      // rewritten it with its own token — deleting that would free a lock we
      // no longer hold and break mutual exclusion.
      if (readFileSync(lockPath, 'utf8') === token) unlinkSync(lockPath);
    } catch {
      /* gone already / unreadable — nothing of ours to release */
    }
  }
}

/** Spin on O_EXCL open until acquired, the lock is stolen as stale, or the deadline passes. */
function acquireLock(
  lockPath: string,
  deadline: number,
  retryMs: number,
  staleMs: number,
  maxWaitMs: number,
): { fd: number; token: string } {
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx'); // O_CREAT | O_EXCL — fails if it exists
      // Stamp the lock with an ownership token so release can verify we still
      // hold it. A stale-takeover by another process reopens via this path and
      // writes its own token, keeping release ownership-safe on both sides.
      const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
      writeSync(fd, token);
      return { fd, token };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        // lock vanished between open and stat — honor the deadline so a lock
        // that repeatedly appears/disappears can't spin past maxWaitMs.
        if (Date.now() >= deadline)
          throw new Error(`audit lock timeout after ${maxWaitMs}ms: ${lockPath}`);
        sleepSync(retryMs);
        continue;
      }
      if (Date.now() >= deadline)
        throw new Error(`audit lock timeout after ${maxWaitMs}ms: ${lockPath}`);
      sleepSync(retryMs);
    }
  }
}
