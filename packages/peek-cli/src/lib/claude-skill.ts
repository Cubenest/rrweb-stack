// Claude Code Skill installer. Writes a self-documenting SKILL.md into
// `~/.claude/skills/peek/SKILL.md` so Claude Code auto-loads it on session
// start and knows when to reach for peek's MCP tools.
//
// The canonical skill content lives at `packages/peek-cli/skills/peek-skill.md`
// in the repo. `scripts/postbuild.mjs` copies that folder into `dist/skills/`
// so the installed npm tarball can read it relative to the running JS via
// `defaultSkillSourcePath()` below.
//
// Plain-function shell — no command-line side effects in this module. Tests
// inject `readFile` + `writeFile` + `mkdir` to verify behavior without
// touching the real filesystem.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where Claude Code looks for the peek skill on a user's machine. */
export function claudeSkillTargetPath(homeDir: string): string {
  return join(homeDir, '.claude', 'skills', 'peek', 'SKILL.md');
}

/**
 * Path to the canonical skill content shipped in the installed npm tarball.
 *
 * After `pnpm build`, `scripts/postbuild.mjs` copies `skills/peek-skill.md`
 * to `dist/skills/peek-skill.md`. This function resolves the path RELATIVE
 * to the running JS so the same logic works for:
 *   - the published tarball: `<pkg>/dist/lib/claude-skill.js` →
 *     `<pkg>/dist/skills/peek-skill.md`
 *   - a local `pnpm --filter @peekdev/cli build` checkout: same shape, both
 *     under `dist/`.
 *
 * (When running via ts-node / vitest directly against the .ts source — i.e.
 * during tests — this path resolves under `src/lib/`, which is NOT where the
 * markdown lives. That's why tests inject their own `readFile` rather than
 * exercising this resolver against the filesystem.)
 */
export function defaultSkillSourcePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'skills', 'peek-skill.md');
}

/** Side-effect dependencies. Tests inject mocks; the command shell uses node:fs. */
export interface SkillIO {
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, content: string) => void;
  readonly mkdir: (path: string) => void;
  readonly fileExists: (path: string) => boolean;
}

export type InstallSkillOutcome =
  | { readonly status: 'wrote'; readonly target: string }
  | { readonly status: 'updated'; readonly target: string }
  | { readonly status: 'unchanged'; readonly target: string }
  | { readonly status: 'source_missing'; readonly source: string }
  | { readonly status: 'error'; readonly target: string; readonly error: string };

/**
 * Install (or refresh) the peek SKILL.md at `~/.claude/skills/peek/SKILL.md`.
 *
 * Idempotent — re-running over an identical file is a no-op (returns
 * `unchanged`). Overwrites an out-of-date file in place (returns `updated`).
 *
 * Never deletes anything; never reads any user state other than the existing
 * SKILL.md it would replace.
 */
export function installSkill(
  homeDir: string,
  io: SkillIO,
  sourcePath: string = defaultSkillSourcePath(),
): InstallSkillOutcome {
  if (!io.fileExists(sourcePath)) {
    return { status: 'source_missing', source: sourcePath };
  }

  let content: string;
  try {
    content = io.readFile(sourcePath);
  } catch (err) {
    return {
      status: 'error',
      target: claudeSkillTargetPath(homeDir),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const target = claudeSkillTargetPath(homeDir);
  const targetExists = io.fileExists(target);

  if (targetExists) {
    try {
      if (io.readFile(target) === content) {
        return { status: 'unchanged', target };
      }
    } catch {
      // unreadable existing file — fall through and overwrite it
    }
  }

  try {
    io.mkdir(dirname(target));
    io.writeFile(target, content);
  } catch (err) {
    return {
      status: 'error',
      target,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { status: targetExists ? 'updated' : 'wrote', target };
}
