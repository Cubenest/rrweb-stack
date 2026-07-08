// `peek connect <add|list|remove|start|stop|status|logs|__supervise>` command
// shell (SP6b-2). The connector registry lives in ~/.peek/connect/connectors.json
// (written via Task 1 — src/lib/connect/registry.ts). Surface descriptors come
// from Task 2 — src/lib/connect/descriptors.ts. Lifecycle verbs (start/stop/
// status/logs/__supervise) are stubs here; they are filled by Tasks 7-9.

import { parseArgs } from 'node:util';
import { getDescriptor } from '../lib/connect/descriptors.js';
import { addConnector, readConnectors, removeConnector } from '../lib/connect/registry.js';

const USAGE = `Usage: peek connect <subcommand> [options]

Subcommands:
  add <surface> [--name <n>] [--command <c>] [--args <a...>]
                               Register a connector for a surface
  list                         List all configured connectors
  remove <name>                Remove a connector from the registry
  start  <name>                Start a connector daemon         (SP6b-2 Task 7)
  stop   <name>                Stop a running connector daemon  (SP6b-2 Task 8)
  status [name]                Show connector daemon status     (SP6b-2 Task 8)
  logs   <name>                Stream connector logs            (SP6b-2 Task 9)

Known surfaces: slack

Run \`peek connect <subcommand> --help\` for subcommand-specific options.
`;

const INTERACTIVE_SETUP_GUIDANCE = `
  Next: run the connector once interactively to capture its tokens and pair it,
  then start the daemon with \`peek connect start <name>\`.
`;

export async function runConnect(argv: string[]): Promise<number> {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return sub === undefined ? 1 : 0;
  }

  try {
    switch (sub) {
      case 'add':
        return runAdd(rest);
      case 'list':
        return runList();
      case 'remove':
        return runRemove(rest);
      // Lifecycle verbs — stubs; implemented by Tasks 7-9.
      case 'start':
      case 'stop':
      case 'status':
      case 'logs':
      case '__supervise':
        process.stdout.write(`peek connect ${sub}: not implemented yet (SP6b-2 Tasks 7-9)\n`);
        return 0;
      default:
        process.stderr.write(`peek connect: unknown subcommand '${sub}'\n\n`);
        process.stdout.write(USAGE);
        return 1;
    }
  } catch (err) {
    process.stderr.write(`peek connect: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

// ── add ────────────────────────────────────────────────────────────────────

const ADD_FLAGS = {
  name: { type: 'string' },
  command: { type: 'string' },
  args: { type: 'string', multiple: true },
  help: { type: 'boolean' },
} as const;

function runAdd(rest: string[]): number {
  const surface = rest[0];
  if (surface === undefined || surface.startsWith('-')) {
    process.stderr.write('peek connect add: missing <surface> argument\n');
    process.stdout.write(USAGE);
    return 1;
  }

  let values: {
    name?: string;
    command?: string;
    args?: string[];
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({ args: rest.slice(1), options: ADD_FLAGS, allowPositionals: false }));
  } catch (err) {
    process.stderr.write(`peek connect add: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (values.help === true) {
    process.stdout.write(USAGE);
    return 0;
  }

  const descriptor = getDescriptor(surface);
  if (descriptor === undefined && values.command === undefined) {
    process.stderr.write(
      `peek connect add: unknown surface '${surface}' — pass --command to use a custom connector binary\n`,
    );
    return 1;
  }

  const name = values.name ?? surface;

  // Build entry conditionally to satisfy exactOptionalPropertyTypes.
  const entry = {
    surface,
    enabled: true,
    ...(values.command !== undefined ? { command: values.command } : {}),
    ...(values.args !== undefined && values.args.length > 0 ? { args: values.args } : {}),
  };

  addConnector(name, entry);

  process.stdout.write(`Connector '${name}' (surface: ${surface}) added to the registry.\n`);
  process.stdout.write(INTERACTIVE_SETUP_GUIDANCE);
  return 0;
}

// ── list ───────────────────────────────────────────────────────────────────

function runList(): number {
  const file = readConnectors();
  const entries = Object.entries(file.connectors);

  if (entries.length === 0) {
    process.stdout.write('no connectors configured\n');
    return 0;
  }

  for (const [name, entry] of entries) {
    const enabledLabel = entry.enabled ? 'enabled' : 'disabled';
    const commandPart = entry.command !== undefined ? `  command: ${entry.command}` : '';
    process.stdout.write(`${name}  ${entry.surface}  ${enabledLabel}${commandPart}\n`);
  }
  return 0;
}

// ── remove ─────────────────────────────────────────────────────────────────

function runRemove(rest: string[]): number {
  const name = rest[0];
  if (name === undefined) {
    process.stderr.write('peek connect remove: missing <name> argument\n');
    return 1;
  }

  removeConnector(name);
  process.stdout.write(`Connector '${name}' removed from the registry.\n`);
  return 0;
}
