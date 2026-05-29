// Unit tests for the runner + package-manager detection logic. Pure — no
// real filesystem (an injected `fileExists` stub is enough). Tempdir
// integration coverage lives in init.test.ts.

import { describe, expect, it } from 'vitest';
import {
  type PackageManager,
  type Runner,
  detectPackageManager,
  detectRunner,
  findRunnerConfig,
  installCommand,
} from '../src/lib/detect.js';

/** Build an injectable `fileExists` from a set of present absolute paths. */
function presence(paths: string[]): (p: string) => boolean {
  const set = new Set(paths);
  return (p) => set.has(p);
}

const CWD = '/work/proj';
const j = (...parts: string[]) => [CWD, ...parts].join('/');

describe('detectRunner', () => {
  it('returns undefined when nothing matches', () => {
    expect(detectRunner(CWD, presence([]))).toBeUndefined();
  });

  it('detects wdio.conf.ts as wdio', () => {
    const r = detectRunner(CWD, presence([j('wdio.conf.ts')]));
    expect(r).toEqual({ runner: 'wdio', configPath: j('wdio.conf.ts') });
  });

  it('detects wdio.conf.js / .mjs / .cjs as wdio', () => {
    for (const f of ['wdio.conf.js', 'wdio.conf.mjs', 'wdio.conf.cjs']) {
      const r = detectRunner(CWD, presence([j(f)]));
      expect(r?.runner).toBe('wdio');
      expect(r?.configPath).toBe(j(f));
    }
  });

  it('detects playwright.config.* as playwright', () => {
    for (const f of [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
      'playwright.config.cjs',
    ]) {
      const r = detectRunner(CWD, presence([j(f)]));
      expect(r?.runner).toBe('playwright');
      expect(r?.configPath).toBe(j(f));
    }
  });

  it('detects cypress.config.* as cypress', () => {
    for (const f of [
      'cypress.config.ts',
      'cypress.config.js',
      'cypress.config.mjs',
      'cypress.config.cjs',
    ]) {
      const r = detectRunner(CWD, presence([j(f)]));
      expect(r?.runner).toBe('cypress');
      expect(r?.configPath).toBe(j(f));
    }
  });

  it('prefers WDIO when multiple runner configs are present', () => {
    const r = detectRunner(
      CWD,
      presence([j('playwright.config.ts'), j('cypress.config.ts'), j('wdio.conf.ts')]),
    );
    expect(r?.runner).toBe('wdio');
  });

  it('prefers Playwright over Cypress when both present', () => {
    const r = detectRunner(CWD, presence([j('playwright.config.ts'), j('cypress.config.ts')]));
    expect(r?.runner).toBe('playwright');
  });

  it('picks the first config-file extension in order (ts > js > mjs > cjs)', () => {
    const r = detectRunner(CWD, presence([j('wdio.conf.cjs'), j('wdio.conf.ts')]));
    expect(r?.configPath).toBe(j('wdio.conf.ts'));
  });
});

describe('findRunnerConfig', () => {
  it('returns the path of the runner config when present', () => {
    const p = findRunnerConfig(CWD, 'wdio', presence([j('wdio.conf.ts')]));
    expect(p).toBe(j('wdio.conf.ts'));
  });

  it('returns undefined when the forced runner has no matching config', () => {
    const p = findRunnerConfig(CWD, 'wdio', presence([j('playwright.config.ts')]));
    expect(p).toBeUndefined();
  });

  it.each([['wdio'], ['playwright'], ['cypress']] as Array<[Runner]>)(
    'resolves the canonical .ts config for %s',
    (runner) => {
      const map: Record<Runner, string> = {
        wdio: 'wdio.conf.ts',
        playwright: 'playwright.config.ts',
        cypress: 'cypress.config.ts',
      };
      const p = findRunnerConfig(CWD, runner, presence([j(map[runner])]));
      expect(p).toBe(j(map[runner]));
    },
  );
});

describe('detectPackageManager', () => {
  it('falls back to npm (with fallback=true) when no lockfile present', () => {
    const r = detectPackageManager(CWD, presence([]));
    expect(r.manager).toBe('npm');
    expect(r.fallback).toBe(true);
    expect(r.multipleLockfiles).toBe(false);
    expect(r.lockfilesFound).toEqual([]);
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    const r = detectPackageManager(CWD, presence([j('pnpm-lock.yaml')]));
    expect(r.manager).toBe('pnpm');
    expect(r.fallback).toBe(false);
    expect(r.multipleLockfiles).toBe(false);
    expect(r.lockfilesFound).toEqual(['pnpm-lock.yaml']);
  });

  it.each([
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
  ] as Array<[string, PackageManager]>)('detects %s as %s', (lockfile, manager) => {
    const r = detectPackageManager(CWD, presence([j(lockfile)]));
    expect(r.manager).toBe(manager);
    expect(r.fallback).toBe(false);
  });

  it('with multiple lockfiles, prefers pnpm and flags multipleLockfiles', () => {
    const r = detectPackageManager(
      CWD,
      presence([j('pnpm-lock.yaml'), j('yarn.lock'), j('package-lock.json')]),
    );
    expect(r.manager).toBe('pnpm');
    expect(r.multipleLockfiles).toBe(true);
    expect(r.lockfilesFound).toEqual(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']);
  });

  it('with yarn + npm but no pnpm, prefers yarn', () => {
    const r = detectPackageManager(CWD, presence([j('yarn.lock'), j('package-lock.json')]));
    expect(r.manager).toBe('yarn');
    expect(r.multipleLockfiles).toBe(true);
  });
});

describe('installCommand', () => {
  it('produces the documented install command for each manager', () => {
    expect(installCommand('pnpm')).toEqual(['pnpm', 'add', '-D', '@tracelane/wdio']);
    expect(installCommand('yarn')).toEqual(['yarn', 'add', '-D', '@tracelane/wdio']);
    expect(installCommand('npm')).toEqual(['npm', 'install', '--save-dev', '@tracelane/wdio']);
    expect(installCommand('bun')).toEqual(['bun', 'add', '-d', '@tracelane/wdio']);
  });

  it('lets callers override the package name (for tests / alpha tag pinning)', () => {
    expect(installCommand('npm', '@tracelane/wdio@0.1.0-alpha.5')).toEqual([
      'npm',
      'install',
      '--save-dev',
      '@tracelane/wdio@0.1.0-alpha.5',
    ]);
  });

  it('returns a non-empty argv (program is always first)', () => {
    for (const m of ['pnpm', 'yarn', 'npm', 'bun'] as PackageManager[]) {
      const cmd = installCommand(m);
      expect(cmd.length).toBeGreaterThan(1);
      expect(typeof cmd[0]).toBe('string');
    }
  });
});
