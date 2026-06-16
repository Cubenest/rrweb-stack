// P-16 (2026-05-28 QA walk) — generate a tiny shell wrapper for the native
// host. Chrome (and other Chromium-based browsers) spawn the manifest's `path`
// via the GUI launcher's `$PATH`, NOT the shell's. On macOS with both a
// legacy /usr/local/bin/node and a current /opt/homebrew/bin/node, the system
// PATH resolves `#!/usr/bin/env node` to the older binary — typically
// architecture-mismatched, so `better-sqlite3.node` fails dlopen and the
// host process exits before Chrome reads any output. Chrome silently moves on.
//
// The fix is to write a wrapper that hardcodes `process.execPath` (the node
// that ran `peek init`) and point the manifest at the wrapper. This is the
// well-trodden pattern for any Node-based native messaging host.
//
// Pure helpers — `writeNativeHostWrapper` (in commands/init.ts) does the
// filesystem write. Tests pin the path layout + content shape per platform.

import { posix, win32 } from 'node:path';
import type { SupportedPlatform } from '@peekdev/mcp/native-host';

/**
 * Where the generated wrapper lives. On POSIX it ends in `.sh`; on Windows
 * `.cmd` so the shell that Chrome's CreateProcess invocation finds knows what
 * to execute. The wrapper lives under `~/.peek/` so it shares the same
 * permission scope as the audit log + sessions DB.
 */
export function wrapperPath(peekHomeDir: string, platform: SupportedPlatform): string {
  const filename = platform === 'win32' ? 'peek-mcp-host.cmd' : 'peek-mcp-host.sh';
  // Join with the TARGET platform's separator (win32 for .cmd, posix for .sh)
  // so the path reads correctly regardless of the host running the unit tests
  // — mirrors resolveInstallTargets. In production platform === the host.
  return (platform === 'win32' ? win32 : posix).join(peekHomeDir, filename);
}

/**
 * Body of the wrapper script. Pure — accepts the node binary and the host
 * `.js` path explicitly so tests can hand it any fixture without touching
 * `process.execPath` or `hostBinaryPath()`.
 *
 * POSIX: a `/bin/sh` script that `exec`s `node host.js "$@"`. `exec` replaces
 * the shell so Chrome's process tree stays minimal (it tracks the JS process
 * directly for stdin/stdout, not a shell wrapper that's blocking the pipe).
 *
 * Windows: a `.cmd` that calls node with the args via `%*`. We use
 * Windows line endings (`\r\n`) because some legacy CMD versions choke on
 * LF-only `.cmd` files when invoked via CreateProcess.
 */
export function wrapperContent(
  nodePath: string,
  hostJsPath: string,
  platform: SupportedPlatform,
): string {
  if (platform === 'win32') {
    return `@echo off\r\n"${nodePath}" "${hostJsPath}" %*\r\n`;
  }
  return `#!/bin/sh\nexec "${nodePath}" "${hostJsPath}" "$@"\n`;
}
