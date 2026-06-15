// Atomic file write used by `peek init` when rewriting a user's MCP-client
// config (~/.claude.json etc.). Factored out of the command shell so the
// crash-safety behavior is directly testable.

import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Error codes that, on Windows, mean the rename target (or the freshly-written
 * temp) is TRANSIENTLY locked — an editor with the config open, or antivirus
 * scanning the new temp file — so `MoveFileEx` fails but a retry moments later
 * usually succeeds. POSIX `rename(2)` replaces atomically even while the target
 * is open and never hits these, so we only retry on win32. ENOSPC/ENOENT and
 * friends are NOT in here — those aren't locks and must fail fast.
 */
const WINDOWS_TRANSIENT_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** Synchronous sleep (atomicWriteFileSync is sync, so we can't await). */
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Injectable seams (defaults are the real fs + a sync sleep). For tests. */
export interface AtomicWriteDeps {
  /** Rename implementation (default `fs.renameSync`). */
  readonly rename?: (from: string, to: string) => void;
  /** Synchronous backoff between retries (default {@link syncSleep}). */
  readonly sleep?: (ms: number) => void;
  /** Platform (default `process.platform`); retries happen ONLY on `win32`. */
  readonly platform?: NodeJS.Platform;
  /** Max rename attempts before giving up on a transient Windows lock (default 4). */
  readonly maxRetries?: number;
}

/**
 * Write `content` to `path` atomically: write a temp file in the SAME directory
 * then `renameSync` over the target (rename is atomic on a single filesystem).
 * This avoids the truncate-then-write window of a plain `writeFileSync` that a
 * crash / full disk / OOM could leave as an empty or partial file — and
 * `~/.claude.json` is read on every Claude Code startup. Parent dirs are
 * created; on failure the temp file is best-effort removed.
 *
 * On Windows the final rename can transiently fail with EBUSY/EPERM/EACCES when
 * the target or temp is briefly locked (editor open, antivirus scan); those are
 * retried with a short backoff before giving up. On POSIX a single failed
 * rename throws immediately (no spurious lock errors there).
 */
export function atomicWriteFileSync(
  path: string,
  content: string,
  deps: AtomicWriteDeps = {},
): void {
  const rename = deps.rename ?? renameSync;
  const sleep = deps.sleep ?? syncSleep;
  const platform = deps.platform ?? process.platform;
  const maxRetries = deps.maxRetries ?? 4;

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.peek-tmp-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, content, 'utf8');
    renameWithWindowsRetry(rename, tmp, path, platform, maxRetries, sleep);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp file may not exist (writeFileSync failed before creating it).
    }
    throw err;
  }
}

/** Rename, retrying transient Windows lock errors with backoff. POSIX: one shot. */
function renameWithWindowsRetry(
  rename: (from: string, to: string) => void,
  from: string,
  to: string,
  platform: NodeJS.Platform,
  maxRetries: number,
  sleep: (ms: number) => void,
): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      const retryable =
        platform === 'win32' &&
        attempt < maxRetries &&
        code !== undefined &&
        WINDOWS_TRANSIENT_RENAME_CODES.has(code);
      if (!retryable) throw err;
      // Brief, growing backoff (25ms → 50ms → 100ms…) so the lock holder (AV,
      // editor) has a moment to release before the next MoveFileEx attempt.
      sleep(25 * 2 ** (attempt - 1));
    }
  }
}
