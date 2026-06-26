import { closeSync, openSync, statSync, unlinkSync } from 'node:fs';

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
  let fd: number | undefined;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx'); // O_CREAT | O_EXCL — fails if it exists
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      } // lock vanished between open and stat — retry immediately
      if (Date.now() >= deadline)
        throw new Error(`audit lock timeout after ${maxWaitMs}ms: ${lockPath}`);
      sleepSync(retryMs);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd as number);
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* already removed */
    }
  }
}
