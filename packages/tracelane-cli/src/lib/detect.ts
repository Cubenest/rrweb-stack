// Pure detection helpers for `tracelane init`. Given a project root, figure
// out (a) which test runner this is and (b) which package manager to use to
// add the tracelane dependency. Everything in this file is a pure function of
// (cwd, injected fileExists probe) → result, so it tests cheaply against
// fixture trees and tempdirs.
//
// Runner detection looks ONLY at the project root, not recursively — a
// wdio.conf inside node_modules is not the user's project. Priority order
// when multiple match is WDIO > Playwright > Cypress (WDIO is the only path
// the v0.1 CLI fully wires).

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The test runners tracelane recognises. Only WDIO is fully wired in v0.1. */
export type Runner = 'wdio' | 'playwright' | 'cypress';

/** The package managers tracelane recognises (lockfile-driven detection). */
export type PackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';

interface RunnerSpec {
  readonly runner: Runner;
  readonly configFiles: readonly string[];
}

// Priority order: WDIO first because it's the only runner the CLI can wire
// end-to-end today. Playwright + Cypress detection drives a no-op "support
// coming Q3/Q4 2026" branch — they're listed so a user with both a Playwright
// and a Cypress config still gets routed to the more-mature path.
const RUNNER_SPECS: readonly RunnerSpec[] = [
  {
    runner: 'wdio',
    configFiles: ['wdio.conf.ts', 'wdio.conf.js', 'wdio.conf.mjs', 'wdio.conf.cjs'],
  },
  {
    runner: 'playwright',
    configFiles: [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
      'playwright.config.cjs',
    ],
  },
  {
    runner: 'cypress',
    configFiles: [
      'cypress.config.ts',
      'cypress.config.js',
      'cypress.config.mjs',
      'cypress.config.cjs',
    ],
  },
];

/** One detected runner + the config file that triggered the detection. */
export interface DetectedRunner {
  readonly runner: Runner;
  /** Absolute path to the config file we matched on. */
  readonly configPath: string;
}

/**
 * Detect the test runner in `cwd`. Scans only the project root (not
 * recursive) and returns the highest-priority match per RUNNER_SPECS. Returns
 * `undefined` if nothing matched — the caller prints the "no runner detected"
 * message and exits 1.
 *
 * `fileExists` is injected so unit tests can stub it; production callers pass
 * the real `existsSync`.
 */
export function detectRunner(
  cwd: string,
  fileExists: (path: string) => boolean = existsSync,
): DetectedRunner | undefined {
  for (const spec of RUNNER_SPECS) {
    for (const f of spec.configFiles) {
      const p = join(cwd, f);
      if (fileExists(p)) return { runner: spec.runner, configPath: p };
    }
  }
  return undefined;
}

/**
 * Detect runner where the user passed `--runner` explicitly. We still try to
 * find a matching config file (so the caller can edit it later) — if none of
 * the runner's known config-file shapes exists, we return the runner with a
 * `configPath` of undefined and let the caller decide whether that's fatal.
 *
 * For the wdio happy path the editor requires `configPath`, so the caller
 * should print a helpful "no wdio.conf.* found in {cwd}" message and exit 1.
 */
export function findRunnerConfig(
  cwd: string,
  runner: Runner,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  const spec = RUNNER_SPECS.find((s) => s.runner === runner);
  if (!spec) return undefined;
  for (const f of spec.configFiles) {
    const p = join(cwd, f);
    if (fileExists(p)) return p;
  }
  return undefined;
}

interface PackageManagerSpec {
  readonly manager: PackageManager;
  readonly lockfile: string;
}

// Priority order: pnpm > yarn > npm > bun, matching most monorepos' actual
// preference. This is only consulted when MULTIPLE lockfiles exist — a
// pathological repo state we warn about but don't refuse.
const PM_SPECS: readonly PackageManagerSpec[] = [
  { manager: 'pnpm', lockfile: 'pnpm-lock.yaml' },
  { manager: 'yarn', lockfile: 'yarn.lock' },
  { manager: 'npm', lockfile: 'package-lock.json' },
  { manager: 'bun', lockfile: 'bun.lockb' },
];

/** Result of package-manager detection. */
export interface DetectedPackageManager {
  readonly manager: PackageManager;
  /** All lockfiles that were present (for the multiple-lockfiles warning). */
  readonly lockfilesFound: readonly string[];
  /** True if multiple lockfiles were present — caller should warn. */
  readonly multipleLockfiles: boolean;
  /** True if we fell back to `npm` because no lockfile was present. */
  readonly fallback: boolean;
}

/**
 * Detect the package manager in `cwd` from lockfile presence. If multiple
 * lockfiles are present, prefers pnpm > yarn > npm > bun and flags it on the
 * result. If none are present, defaults to `npm` with `fallback: true`.
 */
export function detectPackageManager(
  cwd: string,
  fileExists: (path: string) => boolean = existsSync,
): DetectedPackageManager {
  const present = PM_SPECS.filter((s) => fileExists(join(cwd, s.lockfile)));
  if (present.length === 0) {
    return {
      manager: 'npm',
      lockfilesFound: [],
      multipleLockfiles: false,
      fallback: true,
    };
  }
  const top = present[0];
  if (!top) {
    // Unreachable — `present.length === 0` is handled above — but the
    // noUncheckedIndexedAccess rule wants the explicit guard.
    return { manager: 'npm', lockfilesFound: [], multipleLockfiles: false, fallback: true };
  }
  return {
    manager: top.manager,
    lockfilesFound: present.map((p) => p.lockfile),
    multipleLockfiles: present.length > 1,
    fallback: false,
  };
}

/**
 * Build the package-manager install command for adding `@tracelane/wdio` as
 * a devDependency. Returned as `[program, ...args]` for `spawnSync`, NOT a
 * single shell string — `sh -c` is avoided to dodge injection on Windows and
 * paths-with-spaces. Each manager has its own dev-flag spelling:
 *
 *   pnpm add -D @tracelane/wdio
 *   yarn add -D @tracelane/wdio
 *   npm install --save-dev @tracelane/wdio
 *   bun add -d @tracelane/wdio
 */
export function installCommand(
  manager: PackageManager,
  pkg = '@tracelane/wdio',
): readonly string[] {
  switch (manager) {
    case 'pnpm':
      return ['pnpm', 'add', '-D', pkg];
    case 'yarn':
      return ['yarn', 'add', '-D', pkg];
    case 'npm':
      return ['npm', 'install', '--save-dev', pkg];
    case 'bun':
      return ['bun', 'add', '-d', pkg];
  }
}
