// Long-held single-instance supervisor lock for `peek connect`.
//
// The lock is an O_EXCL file at a caller-supplied path. The owning process
// holds it for its entire lifetime (acquire → hold → release on exit). A dead
// PID in an existing lock file is treated as stale: the file is removed and a
// single retry is attempted. All fs and pid-probe operations are injectable for
// testing without touching the real filesystem.

import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

// ── Public types ───────────────────────────────────────────────────────────

export interface LockInfo {
  pid: number;
  startedAtMs: number;
}

export interface LockDeps {
  /** Override for `openSync(path, 'wx')` — returns a file descriptor. */
  openExclSync?: (path: string) => number;
  /** Override for `readFileSync(path, 'utf8')`. */
  readFileSync?: (path: string) => string;
  /** Override for `unlinkSync(path)`. */
  unlinkSync?: (path: string) => void;
  /** Returns true if `pid` names a running process. */
  pidAlive?: (pid: number) => boolean;
  /** Clock used to stamp `startedAtMs`. */
  now?: () => number;
}

// ── Default implementations ────────────────────────────────────────────────

/**
 * Default pid-alive probe: send signal 0 to the process. Returns `true` if
 * the process exists (including EPERM — it exists but belongs to another user).
 */
function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ── readSupervisorLock ─────────────────────────────────────────────────────

/**
 * Read and parse the lock file at `lockPath`. Returns `LockInfo` when the file
 * exists and is valid; returns `null` if absent, malformed, or missing fields
 * (never throws).
 */
export function readSupervisorLock(lockPath: string, deps?: LockDeps): LockInfo | null {
  const fsRead = deps?.readFileSync ?? ((p: string) => readFileSync(p, 'utf8'));
  let raw: string;
  try {
    raw = fsRead(lockPath);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('pid' in parsed) ||
    !('startedAtMs' in parsed) ||
    typeof (parsed as Record<string, unknown>).pid !== 'number' ||
    typeof (parsed as Record<string, unknown>).startedAtMs !== 'number'
  ) {
    return null;
  }
  const { pid, startedAtMs } = parsed as { pid: number; startedAtMs: number };
  return { pid, startedAtMs };
}

// ── isSupervisorRunning ────────────────────────────────────────────────────

/**
 * Returns `true` only when the lock file exists **and** its recorded PID is
 * alive (i.e. another supervisor instance is genuinely running).
 */
export function isSupervisorRunning(lockPath: string, deps?: LockDeps): boolean {
  const pidAlive = deps?.pidAlive ?? defaultPidAlive;
  const info = readSupervisorLock(lockPath, deps);
  return info !== null && pidAlive(info.pid);
}

// ── acquireSupervisorLock ──────────────────────────────────────────────────

/**
 * Try to acquire a long-held supervisor lock at `lockPath`.
 *
 * Returns `{ release }` on success. `release()` unlinks the file; calling it
 * more than once is safe (ENOENT is swallowed).
 *
 * Returns `null` when another live supervisor holds the lock.
 *
 * Stale-takeover: if the lock file exists and its PID is dead (or the file is
 * malformed), the file is removed and a single retry is attempted. If the
 * retry also fails with EEXIST (a racing process grabbed it), returns `null`.
 */
export function acquireSupervisorLock(
  lockPath: string,
  deps?: LockDeps,
): { release: () => void } | null {
  const fsOpen = deps?.openExclSync ?? ((p: string) => openSync(p, 'wx'));
  const fsRead = deps?.readFileSync ?? ((p: string) => readFileSync(p, 'utf8'));
  const fsUnlink = deps?.unlinkSync ?? unlinkSync;
  const pidAlive = deps?.pidAlive ?? defaultPidAlive;
  const now = deps?.now ?? (() => Date.now());

  const tryOpen = (): { fd: number } | 'eexist' => {
    try {
      const fd = fsOpen(lockPath);
      return { fd };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return 'eexist';
      throw e;
    }
  };

  const writeAndClose = (fd: number): void => {
    const payload = JSON.stringify({ pid: process.pid, startedAtMs: now() });
    writeSync(fd, payload);
    closeSync(fd);
  };

  const release = (): void => {
    try {
      fsUnlink(lockPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      // ENOENT — file already gone; idempotent.
    }
  };

  // First attempt.
  const first = tryOpen();
  if (first !== 'eexist') {
    writeAndClose(first.fd);
    return { release };
  }

  // EEXIST — read the existing lock and decide.
  const existing = readSupervisorLock(lockPath, { readFileSync: fsRead });

  if (existing !== null && pidAlive(existing.pid)) {
    // A live supervisor holds the lock — do not take over.
    return null;
  }

  // Stale lock (dead PID or malformed) — remove it and retry once.
  try {
    fsUnlink(lockPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    // Vanished between our read and unlink — fine; retry anyway.
  }

  const second = tryOpen();
  if (second === 'eexist') {
    // A racing process grabbed it first — give up.
    return null;
  }

  writeAndClose(second.fd);
  return { release };
}
