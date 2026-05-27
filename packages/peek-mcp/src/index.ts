#!/usr/bin/env node
// `peek-mcp` entry. The same binary serves two roles depending on argv
// (ADR-0007):
//   - `peek-mcp --native-host` (or via the native-messaging manifest's `path`):
//      run the native messaging host that owns ~/.peek/sessions.db.
//   - `peek-mcp` (default): run the stdio MCP server AI tools spawn.
//
// The MCP server itself is implemented in Phase 3c; this dispatcher keeps the
// surface stable so the manifest path and `npx -y @peekdev/mcp` invocations are
// already correct.

import { startNativeHost } from './native-host/host.js';

/** Decide the run mode from argv. Native-host mode if `--native-host` present. */
export function resolveMode(argv: readonly string[]): 'native-host' | 'mcp' {
  return argv.includes('--native-host') ? 'native-host' : 'mcp';
}

async function main(): Promise<void> {
  const mode = resolveMode(process.argv.slice(2));

  if (mode === 'native-host') {
    const host = startNativeHost();
    await host.done;
    host.close();
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
