#!/usr/bin/env node
// `peek-mcp` entry. The same binary serves two roles depending on argv
// (ADR-0007):
//   - native messaging host (owns ~/.peek/sessions.db), entered either via the
//     explicit `--native-host` flag (manual/testing) OR — the path that fires
//     in production — when a browser spawns the manifest's `path`. Chrome/Edge
//     pass the calling extension's origin (`chrome-extension://<id>/`) as the
//     first argument (and on Windows a second arg, the Chrome native window
//     handle), with NO `--native-host` flag. We detect that origin argument so
//     the installed manifest works with zero platform-specific shell wrappers
//     (this supersedes the PRD §A7 `native-host.sh` example).
//   - `peek-mcp` (default): run the stdio MCP server AI tools spawn.
//
// The MCP server itself is implemented in Phase 3c; this dispatcher keeps the
// surface stable so the manifest path and `npx -y @peekdev/mcp` invocations are
// already correct.

import { startNativeHost } from './native-host/host.js';

/** Matches the `chrome-extension://<id>/` origin Chrome/Edge pass when spawning a host. */
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\//;

/**
 * Decide the run mode from argv. Native-host mode when invoked with the
 * explicit `--native-host` flag, or when a browser spawns us with the calling
 * extension's `chrome-extension://...` origin as an argument. Otherwise MCP.
 */
export function resolveMode(argv: readonly string[]): 'native-host' | 'mcp' {
  if (argv.includes('--native-host')) return 'native-host';
  if (argv.some((arg) => EXTENSION_ORIGIN_RE.test(arg))) return 'native-host';
  return 'mcp';
}

/** The `chrome-extension://<id>/` origin Chrome/Edge passed, if any. */
export function callingExtensionOrigin(argv: readonly string[]): string | undefined {
  return argv.find((arg) => EXTENSION_ORIGIN_RE.test(arg));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = resolveMode(argv);

  if (mode === 'native-host') {
    const callerOrigin = callingExtensionOrigin(argv);
    const host = startNativeHost(callerOrigin !== undefined ? { callerOrigin } : {});
    try {
      await host.done;
    } finally {
      // Always release the SQLite handle, even if the stream errored.
      host.close();
    }
    return;
  }

  // Phase 3c fills in the MCP stdio server here.
  console.error('peek-mcp: MCP stdio server is implemented in Phase 3c.');
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(
    `peek-mcp: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exitCode = 1;
});
