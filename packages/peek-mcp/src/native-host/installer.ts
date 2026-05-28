// Native-host manifest installer (P2 PRD §A7). The actual filesystem / registry
// writes are factored behind injectable writer functions so the postinstall
// flow can be unit-tested with fakes — and so a dry run can report exactly what
// *would* be written without touching the real OS.
//
// Windows install path (3d-4):
//   Chrome/Edge on Windows read the native-host manifest path from a registry
//   key under HKCU. The default value of that key is the absolute path to the
//   manifest JSON on disk (conventionally
//   `%LOCALAPPDATA%\<vendor>\<browser>\NativeMessagingHosts\<host>.json`).
//   So the install does TWO things in order:
//     1. write the manifest JSON to disk (target.manifestPath)
//     2. set the registry default value to that path via reg.exe
//   `realSink.writeRegistryKey` shells out to `reg.exe add` (built into every
//   Windows install since XP) and is gated on `process.platform === 'win32'`
//   so a misconfigured target never accidentally fires on darwin/linux.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { InstallTarget, NativeHostManifest } from './manifest.js';

/** Outcome of attempting to install one target. */
export interface InstallResult {
  readonly browser: string;
  /** Filesystem path written (darwin/linux + win32), if any. */
  readonly manifestPath?: string;
  /** Registry key written (win32), if any. */
  readonly registryKey?: string;
  /** True when a write actually happened (false in dry-run mode). */
  readonly written: boolean;
  /** Error message if the write failed; the run continues past failures. */
  readonly error?: string;
}

/**
 * Spawn shape `realSink.writeRegistryKey` uses to invoke `reg.exe`. Injectable
 * so tests can capture argv without spawning a real Windows process.
 */
export type RegExecFn = (file: string, args: readonly string[]) => void;

/** Injectable side-effect surface (defaults to real fs + registry). */
export interface InstallSink {
  /** Write a manifest JSON file at an absolute path (creating parent dirs). */
  writeManifestFile(path: string, contents: string): void;
  /**
   * Point an HKCU registry key's default value at the on-disk manifest path.
   * The manifest file is written separately via `writeManifestFile`; this
   * function does NOT write the file. Errors propagate; the installer catches
   * per-target.
   */
  writeRegistryKey(key: string, manifestPath: string): void;
}

/**
 * Build a real-OS sink. Exported so tests can inject a fake `execFn` while
 * still exercising the platform guard. Production callers use {@link realSink}.
 */
export function buildRealSink(
  deps: {
    execFn?: RegExecFn;
    platform?: NodeJS.Platform;
  } = {},
): InstallSink {
  const execFn: RegExecFn =
    deps.execFn ??
    ((file, args) => {
      execFileSync(file, [...args], { stdio: 'ignore' });
    });
  const platform = deps.platform ?? process.platform;

  return {
    writeManifestFile(path, contents) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, 'utf8');
    },
    writeRegistryKey(key, manifestPath) {
      // Defense in depth: a misconfigured target (win32 entry on darwin/linux)
      // must never silently shell out to a non-existent binary. Throw with a
      // clear, structured message so installManifests records it as a
      // per-target error and the run continues.
      if (platform !== 'win32') {
        throw new Error(
          `realSink.writeRegistryKey called on non-Windows platform (${platform}); refused`,
        );
      }
      if (typeof manifestPath !== 'string' || manifestPath.length === 0) {
        throw new Error(
          `realSink.writeRegistryKey: manifestPath must be a non-empty absolute path (got '${manifestPath}')`,
        );
      }
      // `reg.exe add <KEY> /ve /d <DATA> /f`
      //   /ve  → set the (Default) value (the one Chrome/Edge read)
      //   /d   → data to write
      //   /f   → force, no Y/N prompt
      execFn('reg.exe', ['add', key, '/ve', '/d', manifestPath, '/f']);
    },
  };
}

/**
 * Default real-OS sink (writes to disk + the Windows registry). Constructed
 * once at module-load via {@link buildRealSink}; tests requiring custom
 * platform / execFn should call `buildRealSink` directly instead of mutating
 * this object.
 */
export const realSink: InstallSink = buildRealSink();

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
 *
 * For a target that carries BOTH `manifestPath` AND `registryKey` (Windows),
 * the JSON file is written first and the registry value is then pointed at
 * the just-written path. If the file write throws, the registry write is
 * skipped (don't leave a dangling registry entry pointing nowhere).
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
      }
      if (target.registryKey !== undefined) {
        // Windows targets carry both: the registry value must point at the
        // file we just wrote (or, if the file write was skipped above, the
        // declared target path so a separate prior install still resolves).
        const pathForRegistry = target.manifestPath ?? '';
        sink.writeRegistryKey(target.registryKey, pathForRegistry);
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
