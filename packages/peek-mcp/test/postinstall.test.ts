import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPostinstall } from '../src/postinstall.js';

// `node:os`'s `homedir` is a non-configurable export, so vi.spyOn can't replace
// it. Mock the module instead, keeping every other export real and routing
// homedir through a hoisted, per-test-controllable override.
const osMock = vi.hoisted(() => ({ homedir: vi.fn<[], string>() }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: osMock.homedir };
});

// These tests exercise the *default* postinstall path (no consent env), which
// is a dry run by design (P2 PRD §H1). We assert it logs and never writes —
// it must never throw or touch the real OS during `npm install` / CI.

describe('runPostinstall — default dry run', () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  const savedConsent = process.env.PEEK_INSTALL_NATIVE_HOST;

  const defaultHome = process.platform === 'win32' ? 'C:\\Users\\ci' : '/home/ci';

  beforeEach(() => {
    logs = [];
    // Ensure no consent so we stay on the dry-run path. An empty string is
    // treated the same as unset by the consent gate (only 1/true/yes consents).
    process.env.PEEK_INSTALL_NATIVE_HOST = '';
    // Stable, real-looking home for the mocked os.homedir() so the dry-run
    // paths are deterministic across CI machines.
    osMock.homedir.mockReturnValue(defaultHome);
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env.PEEK_INSTALL_NATIVE_HOST = savedConsent ?? '';
  });

  it('logs the host id, binary path, and a no-files-written notice', () => {
    runPostinstall();
    const out = logs.join('\n');
    // On the supported CI platforms (darwin/linux/win32) it dry-runs; on an
    // unsupported platform it logs a skip — either way it must not throw and
    // must not claim to have written files.
    if (out.includes('not supported')) {
      expect(out).toMatch(/skipping/);
    } else {
      expect(out).toContain('com.cubenest.peek');
      expect(out).toMatch(/host binary:/);
      expect(out).toMatch(/no files were written/);
      // Dry run uses the "·" marker, never the "✔" written marker.
      expect(out).not.toContain('✔');
    }
  });

  it('resolves the home dir via os.homedir(), not the process.env.HOME/USERPROFILE chain', () => {
    // Windows-hardening fix: home must come from os.homedir() (which returns
    // %USERPROFILE% on Windows) — NOT the old `process.env.HOME ??
    // process.env.USERPROFILE` chain, which on Git Bash for Windows picks up a
    // POSIX $HOME (/c/Users/jane) that diverges from where Chrome/Edge actually
    // read the host manifest.
    //
    // We prove the code routes through homedir() by stubbing it to a sentinel
    // and simultaneously setting process.env.HOME to a DIFFERENT bogus value:
    // the logged manifest path must contain the homedir() sentinel and NOT the
    // env value. (On darwin/linux the dry run logs the per-browser manifest
    // path, rooted at home; on win32 the path is rooted at %LOCALAPPDATA% so we
    // only assert the env value never leaks there.)
    const sentinelHome =
      process.platform === 'win32' ? 'C:\\Users\\sentinel' : '/home/sentinel-homedir';
    const bogusEnvHome = '/totally/bogus/home-from-env';
    osMock.homedir.mockReturnValue(sentinelHome);
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = bogusEnvHome;
    process.env.USERPROFILE = bogusEnvHome;
    try {
      runPostinstall();
      const out = logs.join('\n');
      expect(osMock.homedir).toHaveBeenCalled();
      // The env-derived home must never appear — proves we don't read it.
      expect(out).not.toContain(bogusEnvHome);
      if (!out.includes('not supported') && process.platform !== 'win32') {
        // The homedir() sentinel roots at least one logged manifest path.
        expect(out).toContain(sentinelHome);
      }
    } finally {
      // Restore via assignment (matches the PEEK_INSTALL_NATIVE_HOST `?? ''`
      // pattern above; avoids the noDelete lint and the `= undefined` →
      // "undefined" string coercion footgun).
      process.env.HOME = savedHome ?? '';
      process.env.USERPROFILE = savedUserProfile ?? '';
    }
  });
});
