import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPostinstall } from '../src/postinstall.js';

// These tests exercise the *default* postinstall path (no consent env), which
// is a dry run by design (P2 PRD §H1). We assert it logs and never writes —
// it must never throw or touch the real OS during `npm install` / CI.

describe('runPostinstall — default dry run', () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  const savedConsent = process.env.PEEK_INSTALL_NATIVE_HOST;

  beforeEach(() => {
    logs = [];
    // Ensure no consent so we stay on the dry-run path. An empty string is
    // treated the same as unset by the consent gate (only 1/true/yes consents).
    process.env.PEEK_INSTALL_NATIVE_HOST = '';
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
});
