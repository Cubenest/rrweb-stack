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

/**
 * Decode the `stderr` `execFileSync` attaches to a thrown error. `execFileSync`
 * populates `err.stderr` as a Buffer (or string, depending on `encoding`) when
 * the child writes to stderr before a non-zero exit.
 */
function decodeStderr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  // Some shapes hand back a Uint8Array / array-like; coerce defensively.
  try {
    return Buffer.from(value as Uint8Array).toString('utf8');
  } catch {
    return String(value);
  }
}

/**
 * Turn the error `execFileSync` throws when `reg.exe` exits non-zero into a
 * message that actually says *why* it failed.
 *
 * Windows-hardening fix: previously the default `execFn` ran `reg.exe` with
 * `stdio: 'ignore'`, so on failure (EACCES on a redirected/locked HKCU hive,
 * the host running under a restricted token, etc.) the child's stderr was
 * discarded and `installManifests` recorded a useless bare "Command failed".
 * Capturing stderr and folding it (plus the exit status) into the thrown
 * Error's message means the per-target `result.error` is now actionable.
 *
 * Accepts the raw caught value (typed `unknown`) so callers don't have to
 * pre-narrow; reads `.stderr` / `.status` off `execFileSync`'s error shape.
 */
export function formatRegExecError(err: unknown): string {
  const e = (err ?? {}) as { stderr?: unknown; status?: unknown; message?: unknown };
  const stderr = decodeStderr(e.stderr).trim();
  const status = typeof e.status === 'number' ? e.status : undefined;
  const baseMessage = typeof e.message === 'string' ? e.message : String(err);
  // Prefer the child's own stderr (the OS-level reason); fall back to the
  // thrown error's message (e.g. `spawn reg.exe ENOENT` when reg.exe is
  // missing from PATH) so we never produce an empty detail.
  const detail = stderr.length > 0 ? stderr : baseMessage;
  const exitPart = status !== undefined ? ` (exit ${status})` : '';
  return `reg.exe failed${exitPart}: ${detail}`;
}

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
    /**
     * Map a thrown `execFn` error → the message to rethrow. Injectable so the
     * stderr-surfacing wrapper is unit-testable; defaults to
     * {@link formatRegExecError}.
     */
    wrapExecError?: (err: unknown) => string;
  } = {},
): InstallSink {
  // Default execFn: run reg.exe with stderr PIPED (not 'ignore') so a non-zero
  // exit throws an error carrying `.stderr` (and `.status`). That detail is
  // folded into the rethrown message at the writeRegistryKey call site (below),
  // so installManifests records a useful per-target error instead of a bare
  // "Command failed". `stdout` stays ignored (reg.exe's success chatter is
  // noise); only stderr is captured.
  const wrapExecError = deps.wrapExecError ?? formatRegExecError;
  const execFn: RegExecFn =
    deps.execFn ??
    ((file, args) => {
      execFileSync(file, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
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
      // Wrap any execFn throw so the rethrown message carries reg.exe's stderr
      // + exit status (the default execFn pipes stderr precisely so this detail
      // is available). installManifests catches per-target and records the
      // message, so the user finally sees *why* the registry write failed.
      try {
        execFn('reg.exe', ['add', key, '/ve', '/d', manifestPath, '/f']);
      } catch (err) {
        throw new Error(wrapExecError(err));
      }
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
