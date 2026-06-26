#!/usr/bin/env node
// `peek` CLI entry (Task 3.6). A thin read-mostly client of the native host's
// ~/.peek/sessions.db (ADR-0007). Dispatches to the command shells:
//   peek status
//   peek sessions <list|show|export|delete>
//   peek init
//   peek audit log
//   peek audit verify
//
// Arg parsing uses the built-in node:util parseArgs at each command boundary
// (no CLI framework dependency); this top-level dispatcher just routes on the
// first positional so each subcommand owns its own option schema.

import { runAudit } from './commands/audit.js';
import { runInit } from './commands/init.js';
import { runSessions } from './commands/sessions.js';
import { runStatus } from './commands/status.js';
import { isDirectInvocation } from './lib/entrypoint.js';
import { CLI_VERSION } from './version.js';

const HELP = `peek ${CLI_VERSION} — browser-session companion CLI

Usage: peek <command> [options]

Commands:
  status                       Native-host registration, DB size + schema, extension state
  sessions list                List recent sessions
  sessions show <id>           Show one session (metadata + console/network errors)
  sessions export <id>         Export a session (--format markdown|json|html|playwright)
  sessions delete <id>         Delete a session (or --all-older-than <dur>)
  init                         Interactive wizard: configure MCP clients + native host
  audit log                    Show the act-tool audit log (--since/--tool/--client)
  audit verify                 Verify the audit log hash chain (exit 0 ok, 1 anomaly, 2 tampered)

Run \`peek <command> --help\` for command-specific options.

The native messaging host (@peekdev/mcp) owns the database; this CLI reads it.
Set PEEK_HOME to relocate ~/.peek. Docs: https://github.com/Cubenest/rrweb-stack
`;

export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'status':
      return runStatus();
    case 'sessions':
      return runSessions(rest);
    case 'audit':
      return runAudit(rest);
    case 'init':
      return runInit(rest);
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${CLI_VERSION}\n`);
      return 0;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      // No command given is a usage error (exit 1); explicit help is success.
      return command === undefined ? 1 : 0;
    default:
      process.stderr.write(`peek: unknown command '${command}'\n\n`);
      process.stdout.write(HELP);
      return 1;
  }
}

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}

// Run only when invoked directly as the `peek` bin (npx / shell), not when this
// module is imported (tests, or another package consuming `run`), so an ESM
// `import` has no side effects. Uses pathToFileURL (see lib/entrypoint.ts) so
// the guard matches on Windows backslash paths — a plain `file://` + argv
// concat was always false there, making every `peek` command a silent no-op.
if (isDirectInvocation(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    process.stderr.write(
      `peek: fatal — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
