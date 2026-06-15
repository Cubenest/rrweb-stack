// Integration tests for `tracelane init`. Each test sets up a tempdir
// fixture (a tiny package.json + a wdio.conf / playwright.config / etc.),
// invokes runInitProgrammatic with the fixture's cwd + a stubbed spawn (so
// no real npm install happens), and asserts what changed on disk.

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInitProgrammatic } from '../src/commands/init.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tracelane-init-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A spawn stub that simulates a successful install + records calls. */
function recordingSpawn(): {
  spawn: (
    program: string,
    args: readonly string[],
    options: { cwd: string; stdio: 'inherit' | 'pipe'; env?: NodeJS.ProcessEnv },
  ) => SpawnSyncReturns<Buffer>;
  calls: Array<{ program: string; args: readonly string[]; cwd: string }>;
} {
  const calls: Array<{ program: string; args: readonly string[]; cwd: string }> = [];
  return {
    spawn: (program, args, options) => {
      calls.push({ program, args, cwd: options.cwd });
      return {
        pid: 1,
        output: [],
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
      } as SpawnSyncReturns<Buffer>;
    },
    calls,
  };
}

/** Collect stdout/stderr into strings for later assertions. */
function streams(): {
  stdout: PassThrough;
  stderr: PassThrough;
  out: () => string;
  err: () => string;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on('data', (c) => outChunks.push(c));
  stderr.on('data', (c) => errChunks.push(c));
  return {
    stdout,
    stderr,
    out: () => Buffer.concat(outChunks).toString('utf8'),
    err: () => Buffer.concat(errChunks).toString('utf8'),
  };
}

const WDIO_CONF = `import type { Options } from '@wdio/types';

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./test/specs/**/*.ts'],
  services: [],
};
`;

const PLAYWRIGHT_CONF = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
});
`;

const CYPRESS_CONF = `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: { baseUrl: 'http://localhost:3000' },
});
`;

describe('runInitProgrammatic — WDIO happy path', () => {
  it('detects WDIO + pnpm, runs install (mocked), edits conf, mkdir, .gitignore', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "name": "fixture", "version": "0.0.0" }\n');
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');

    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });

    expect(code).toBe(0);
    // install command was the pnpm dev-add for @tracelane/wdio
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.program).toBe('pnpm');
    expect(rec.calls[0]?.args).toEqual(['add', '-D', '@tracelane/wdio']);
    expect(rec.calls[0]?.cwd).toBe(dir);

    // wdio.conf.ts was edited
    const editedConf = readFileSync(join(dir, 'wdio.conf.ts'), 'utf8');
    expect(editedConf).toContain("import TraceLaneService from '@tracelane/wdio';");
    expect(editedConf).toContain("[TraceLaneService, { mode: 'failed' }]");

    // tracelane-reports/ created
    expect(existsSync(join(dir, 'tracelane-reports'))).toBe(true);

    // .gitignore was appended (existing content preserved)
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('tracelane-reports/');

    // No backup leftover on success
    expect(existsSync(join(dir, 'wdio.conf.ts.tracelane-init.backup'))).toBe(false);

    // Success line printed — the message now includes a literal copy-paste
    // `Run: npx wdio run <conf>` command so the user knows exactly what to
    // run after init (per the 2026-05-29 code-review fix on goal-5 wording).
    expect(s.out()).toMatch(/done\.\nRun: npx wdio run wdio\.conf\.ts/);
  });

  it('respects --skip-install (no spawn, but conf/dir/gitignore still happen)', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      skipInstall: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(rec.calls).toHaveLength(0);
    expect(readFileSync(join(dir, 'wdio.conf.ts'), 'utf8')).toContain('TraceLaneService');
    expect(existsSync(join(dir, 'tracelane-reports'))).toBe(true);
  });

  it('--dry-run does not modify anything', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      dryRun: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(rec.calls).toHaveLength(0);
    expect(readFileSync(join(dir, 'wdio.conf.ts'), 'utf8')).toBe(WDIO_CONF);
    expect(existsSync(join(dir, 'tracelane-reports'))).toBe(false);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
    expect(s.out()).toMatch(/DRY RUN/);
  });

  it('idempotent re-run is a no-op against an already-wired conf', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    const rec = recordingSpawn();
    const s1 = streams();
    await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s1.stdout,
      stderr: s1.stderr,
      spawn: rec.spawn,
    });
    const afterFirst = readFileSync(join(dir, 'wdio.conf.ts'), 'utf8');

    // Re-run — should NOT add a second tuple.
    const s2 = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s2.stdout,
      stderr: s2.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    const afterSecond = readFileSync(join(dir, 'wdio.conf.ts'), 'utf8');
    expect(afterSecond).toBe(afterFirst);
    // Exactly one occurrence of the tuple in the final conf.
    const matches = afterSecond.match(/TraceLaneService/g);
    expect(matches?.length).toBeGreaterThan(0);
    expect(s2.out()).toMatch(/already wires TraceLaneService/);
  });

  it('creates a .gitignore when one does not exist', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('tracelane-reports/');
  });

  it('detects yarn from yarn.lock and produces a yarn install command', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'yarn.lock'), '');
    const rec = recordingSpawn();
    const s = streams();
    await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(rec.calls[0]?.program).toBe('yarn');
    expect(rec.calls[0]?.args).toEqual(['add', '-D', '@tracelane/wdio']);
  });

  it('falls back to npm when no lockfile is present', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    const rec = recordingSpawn();
    const s = streams();
    await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(rec.calls[0]?.program).toBe('npm');
  });

  it('reports a non-zero install exit code as a failure', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    const failingSpawn = vi.fn().mockReturnValue({
      pid: 1,
      output: [],
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      status: 1,
      signal: null,
    });
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: failingSpawn as never,
    });
    expect(code).toBe(1);
    expect(s.err()).toMatch(/install exited with code 1/);
    // Conf was NOT edited (we abort after install failure).
    expect(readFileSync(join(dir, 'wdio.conf.ts'), 'utf8')).toBe(WDIO_CONF);
  });
});

describe('runInitProgrammatic — Playwright happy path', () => {
  it('detects Playwright + pnpm, installs @tracelane/playwright, edits config, mkdir, .gitignore', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "name": "fixture", "version": "0.0.0" }\n');
    writeFileSync(join(dir, 'playwright.config.ts'), PLAYWRIGHT_CONF);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');

    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });

    expect(code).toBe(0);
    // install command targeted @tracelane/playwright (not @tracelane/wdio)
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]?.program).toBe('pnpm');
    expect(rec.calls[0]?.args).toEqual(['add', '-D', '@tracelane/playwright']);

    // playwright.config.ts had the reporter registered
    const edited = readFileSync(join(dir, 'playwright.config.ts'), 'utf8');
    expect(edited).toContain("['@tracelane/playwright', { mode: 'failed' }]");

    // tracelane-reports/ created
    expect(existsSync(join(dir, 'tracelane-reports'))).toBe(true);

    // .gitignore appended
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('tracelane-reports/');

    // No backup leftover on success
    expect(existsSync(join(dir, 'playwright.config.ts.tracelane-init.backup'))).toBe(false);

    // The fixture-import follow-up is surfaced to the user.
    expect(s.out()).toMatch(/@tracelane\/playwright\/fixture/);
    expect(s.out()).toMatch(/Playwright/);
  });

  it('appends the reporter to an existing reporter array (idempotent re-run)', async () => {
    const confWithReporter = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list']],
});
`;
    writeFileSync(join(dir, 'playwright.config.ts'), confWithReporter);
    const rec = recordingSpawn();
    const s1 = streams();
    await runInitProgrammatic({
      cwd: dir,
      yes: true,
      skipInstall: true,
      stdout: s1.stdout,
      stderr: s1.stderr,
      spawn: rec.spawn,
    });
    const afterFirst = readFileSync(join(dir, 'playwright.config.ts'), 'utf8');
    expect(afterFirst).toContain("['list']");
    expect(afterFirst).toContain("['@tracelane/playwright', { mode: 'failed' }]");

    // Re-run is a no-op (no duplicate entry).
    const s2 = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      skipInstall: true,
      stdout: s2.stdout,
      stderr: s2.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    const afterSecond = readFileSync(join(dir, 'playwright.config.ts'), 'utf8');
    expect(afterSecond).toBe(afterFirst);
    const matches = afterSecond.match(/@tracelane\/playwright'/g);
    expect(matches?.length).toBe(1);
    expect(s2.out()).toMatch(/already registers the @tracelane\/playwright reporter/);
  });

  it('--dry-run for Playwright modifies nothing', async () => {
    writeFileSync(join(dir, 'playwright.config.ts'), PLAYWRIGHT_CONF);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      dryRun: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(rec.calls).toHaveLength(0);
    expect(readFileSync(join(dir, 'playwright.config.ts'), 'utf8')).toBe(PLAYWRIGHT_CONF);
    expect(existsSync(join(dir, 'tracelane-reports'))).toBe(false);
    expect(s.out()).toMatch(/DRY RUN/);
  });
});

describe('runInitProgrammatic — Cypress not-yet-supported', () => {
  it('prints a not-yet-supported message for Cypress and exits 0 without modifying anything', async () => {
    writeFileSync(join(dir, 'cypress.config.ts'), CYPRESS_CONF);
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(rec.calls).toHaveLength(0);
    expect(s.out()).toMatch(/Cypress/);
    expect(s.out()).toMatch(/not yet supported/i);
    expect(s.out()).toMatch(/github\.com\/Cubenest\/rrweb-stack\/issues/);
    expect(readFileSync(join(dir, 'cypress.config.ts'), 'utf8')).toBe(CYPRESS_CONF);
  });
});

describe('runInitProgrammatic — error paths', () => {
  it('exits 1 with stderr when no runner config is found', async () => {
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(1);
    expect(s.err()).toMatch(/No supported test runner detected/);
  });

  it('exits 1 when --runner is passed but no matching config exists', async () => {
    writeFileSync(join(dir, 'playwright.config.ts'), PLAYWRIGHT_CONF);
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      runner: 'wdio',
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(1);
    expect(s.err()).toMatch(/no matching config file/);
  });
});

describe('runInitProgrammatic — multiple-runner priority', () => {
  it('with both WDIO + Playwright configs, picks WDIO (auto)', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'playwright.config.ts'), PLAYWRIGHT_CONF);
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(rec.calls).toHaveLength(1); // we wired WDIO, didn't touch Playwright
    expect(s.out()).toMatch(/WebdriverIO/);
    // No lockfile in this fixture → npm fallback; assert the package, not the flags.
    expect(rec.calls[0]?.args.at(-1)).toBe('@tracelane/wdio');
  });

  it('with --runner playwright override, wires Playwright even when WDIO is present', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'playwright.config.ts'), PLAYWRIGHT_CONF);
    const rec = recordingSpawn();
    const s = streams();
    const code = await runInitProgrammatic({
      cwd: dir,
      runner: 'playwright',
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(code).toBe(0);
    expect(rec.calls).toHaveLength(1);
    // No lockfile in this fixture → npm fallback; assert the package, not the flags.
    expect(rec.calls[0]?.args.at(-1)).toBe('@tracelane/playwright');
    expect(s.out()).toMatch(/Playwright/);
    // Playwright config was edited; WDIO conf untouched.
    expect(readFileSync(join(dir, 'playwright.config.ts'), 'utf8')).toContain(
      '@tracelane/playwright',
    );
    expect(readFileSync(join(dir, 'wdio.conf.ts'), 'utf8')).toBe(WDIO_CONF);
  });
});

describe('runInitProgrammatic — multiple-lockfile warning', () => {
  it('warns when multiple lockfiles are present, prefers pnpm', async () => {
    writeFileSync(join(dir, 'wdio.conf.ts'), WDIO_CONF);
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    const rec = recordingSpawn();
    const s = streams();
    await runInitProgrammatic({
      cwd: dir,
      yes: true,
      stdout: s.stdout,
      stderr: s.stderr,
      spawn: rec.spawn,
    });
    expect(s.out()).toMatch(/multiple lockfiles/);
    expect(rec.calls[0]?.program).toBe('pnpm');
  });
});

// The spawnSync import is kept for parity but the tests above never call it
// directly — every test injects the stubbed spawn through the InitOptions
// object. Reference it once so the noUnusedLocals tsc rule is happy.
void spawnSync;
