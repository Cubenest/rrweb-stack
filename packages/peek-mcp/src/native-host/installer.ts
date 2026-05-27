// Native-host manifest installer (P2 PRD §A7). The actual filesystem / registry
// writes are factored behind injectable writer functions so the postinstall
// flow can be unit-tested with fakes — and so a dry run can report exactly what
// *would* be written without touching the real OS.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InstallTarget, NativeHostManifest } from './manifest.js';

/** Outcome of attempting to install one target. */
export interface InstallResult {
  readonly browser: string;
  /** Filesystem path written (darwin/linux), if any. */
  readonly manifestPath?: string;
  /** Registry key written (win32), if any. */
  readonly registryKey?: string;
  /** True when a write actually happened (false in dry-run mode). */
  readonly written: boolean;
  /** Error message if the write failed; the run continues past failures. */
  readonly error?: string;
}

/** Injectable side-effect surface (defaults to real fs + registry). */
export interface InstallSink {
  /** Write a manifest JSON file at an absolute path (creating parent dirs). */
  writeManifestFile(path: string, contents: string): void;
  /** Point an HKCU registry key's default value at the manifest path. */
  writeRegistryKey(key: string, manifestPath: string, contents: string): void;
}

/** Default real-OS sink. Registry writes are deferred to Windows-only 3d. */
export const realSink: InstallSink = {
  writeManifestFile(path, contents) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  },
  writeRegistryKey(key) {
    // Windows registry registration is implemented in the Windows install path
    // (Phase 3d onboarding). Surface a clear error rather than silently no-op.
    throw new Error(`windows registry registration not yet implemented for ${key} (Phase 3d)`);
  },
};

export interface InstallOptions {
  /** When true, report what would be written without writing (default false). */
  readonly dryRun?: boolean;
  /** Side-effect sink; defaults to the real fs/registry sink. */
  readonly sink?: InstallSink;
}

/**
 * Install `manifest` to every `target`. Failures are captured per-target (so
 * one unwritable browser dir doesn't abort the rest) and returned in the
 * result list. In `dryRun` mode nothing is written and every result has
 * `written: false`.
 */
export function installManifests(
  targets: InstallTarget[],
  manifest: NativeHostManifest,
  options: InstallOptions = {},
): InstallResult[] {
  const dryRun = options.dryRun ?? false;
  const sink = options.sink ?? realSink;
  const contents = `${JSON.stringify(manifest, null, 2)}\n`;
  const results: InstallResult[] = [];

  for (const target of targets) {
    const base = {
      browser: target.browser,
      ...(target.manifestPath !== undefined ? { manifestPath: target.manifestPath } : {}),
      ...(target.registryKey !== undefined ? { registryKey: target.registryKey } : {}),
    };

    if (dryRun) {
      results.push({ ...base, written: false });
      continue;
    }

    try {
      if (target.manifestPath !== undefined) {
        sink.writeManifestFile(target.manifestPath, contents);
      } else if (target.registryKey !== undefined) {
        sink.writeRegistryKey(target.registryKey, '', contents);
      }
      results.push({ ...base, written: true });
    } catch (err) {
      results.push({
        ...base,
        written: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
