// Atomic file write used by `peek init` when rewriting a user's MCP-client
// config (~/.claude.json etc.). Factored out of the command shell so the
// crash-safety behavior is directly testable.

import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Write `content` to `path` atomically: write a temp file in the SAME directory
 * then `renameSync` over the target (rename is atomic on a single filesystem).
 * This avoids the truncate-then-write window of a plain `writeFileSync` that a
 * crash / full disk / OOM could leave as an empty or partial file — and
 * `~/.claude.json` is read on every Claude Code startup. Parent dirs are
 * created; on failure the temp file is best-effort removed.
 */
export function atomicWriteFileSync(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.peek-tmp-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp file may not exist (writeFileSync failed before creating it).
    }
    throw err;
  }
}
