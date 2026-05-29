#!/usr/bin/env node
// `tracelane` CLI entry. v0.1 ships with a single `init` subcommand that
// detects the user's test runner + package manager and wires @tracelane/wdio
// into their wdio.conf.* in one shot. No-op coming-soon paths for Playwright
// and Cypress.
//
// Arg parsing uses the built-in node:util.parseArgs at each command boundary
// (no CLI framework dependency) — this top-level dispatcher just routes on
// the first positional so the subcommand owns its own option schema, matching
// the peek-cli pattern.

import { realpathSync } from 'node:fs';
import { INIT_HELP, runInit } from './commands/init.js';
import { CLI_VERSION } from './version.js';

const HELP = `tracelane ${CLI_VERSION} - drop-in test-failure replay reporter scaffolding

Usage: npx tracelane <command> [options]

Commands:
  init                        Detect runner + wire @tracelane/wdio into the project

Run \`npx tracelane <command> --help\` for command-specific options.

Docs: https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio
`;

export async function run(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'init':
      return runInit(rest);
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${CLI_VERSION}\n`);
      return 0;
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return 0;
    case undefined:
      // Bare `npx tracelane` with no subcommand: print usage + exit 0 (per
      // the v0.1 spec — friendlier than the peek-cli convention of exit 1
      // for missing command, because tracelane has a single subcommand and
      // most users discovering the package via `npx tracelane` haven't
      // typed `init` yet).
      process.stdout.write(HELP);
      return 0;
    default:
      process.stderr.write(`tracelane: unknown command '${command}'\n\n`);
      process.stdout.write(HELP);
      return 1;
  }
}

/** Helper for tests that want the init help string. */
export { INIT_HELP };

async function main(): Promise<void> {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}

// Only run as a CLI when invoked directly as the `tracelane` bin. When this
// module is imported (tests or another package consuming `run`) an ESM
// `import` has no side effects. Mirror peek-cli's guard so symlink/realpath
// resolution doesn't break npx invocations.
const invokedDirectly =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    (() => {
      try {
        return import.meta.url === `file://${realpathSync(process.argv[1])}`;
      } catch {
        return false;
      }
    })());
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(
      `tracelane: fatal - ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
