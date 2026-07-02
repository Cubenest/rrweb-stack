// `peek audit log [--since <dur>] [--tool <name>] [--client <name>]` command
// shell (Task 3.10, ADR-0010 / P2 PRD §H3). Reads ~/.peek/audit.log (JSONL),
// runs the pure parse + filter, and prints. The native host / extension write
// the log; the CLI only reads it.
// `peek audit verify [--dir <path>] [--json]` (Task 6) — verify the hash
// chain and report integrity status (exit 0/1/2).

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  type AuditEntry,
  type AuditFilter,
  filterAuditEntries,
  parseAuditLog,
} from '../lib/audit.js';
import { cutoffBefore } from '../lib/duration.js';
import { auditLogPath } from '../lib/peek-home.js';
import { runAuditBundle } from './audit-bundle.js';
import { runAuditVerify } from './audit-verify.js';

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: peek audit <subcommand> [options]',
      '',
      'Subcommands:',
      '  log     Show the act-tool audit log',
      '  verify  Verify the audit log hash chain',
      '  bundle  Package the audit log into a portable evidence archive',
      '',
      'peek audit log [options]',
      '  --since <dur>     Only entries newer than e.g. 1h, 30m, 7d',
      '  --tool <name>     Filter by tool (e.g. execute_action)',
      '  --client <name>   Filter by MCP client (e.g. cursor, claude-code)',
      '  --json            Emit matching entries as JSON instead of a table',
      '  --help            Show this help and exit',
      '',
      'peek audit verify [options]',
      '  --dir <path>      Directory containing audit.log + audit.head.json',
      '                    (default: ~/.peek)',
      '  --bundle <file>   Verify a *.peekaudit archive (mutually exclusive with --dir)',
      '  --json            Emit result as JSON instead of human text',
      '  Exit: 0=intact/no-log, 1=anomaly, 2=tampered',
      '',
      'peek audit bundle [options]',
      '  --dir <path>      Directory containing audit.log + audit.head.json',
      '                    (default: ~/.peek)',
      '  --out <file>      Output path (default: ./peek-audit-<date>.peekaudit)',
      '  --help            Show this help and exit',
      '',
    ].join('\n'),
  );
}

function renderEntry(e: AuditEntry): string {
  const parts = [
    e.ts,
    e.tool ?? '(no tool)',
    e.client ? `client=${e.client}` : '',
    e.result ? `result=${e.result}` : '',
    e.sessionId ? `session=${e.sessionId}` : '',
  ].filter(Boolean);
  let line = parts.join('  ');
  if (e.args !== undefined) {
    line += `  args=${JSON.stringify(e.args)}`;
  }
  return line;
}

/** Entry for `peek audit ...`; `argv` excludes the `audit` token. */
export function runAudit(argv: string[]): number | Promise<number> {
  const sub = argv[0];
  if (sub === 'verify') {
    return runAuditVerify(argv.slice(1));
  }
  if (sub === 'bundle') {
    return runAuditBundle(argv.slice(1));
  }
  if (sub !== 'log') {
    if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
      printUsage();
      return sub === undefined ? 1 : 0;
    }
    process.stderr.write(
      `peek audit: unknown subcommand '${sub}' (did you mean 'log', 'verify', or 'bundle'?)\n`,
    );
    return 1;
  }

  // P-18 (alpha.7): declare `--help` as a known option so passing it doesn't
  // crash parseArgs with `TypeError: Unknown option`. Short-circuit to usage
  // BEFORE any DB / log read so `peek audit log --help` always works even on
  // a broken install.
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      since: { type: 'string' },
      tool: { type: 'string' },
      client: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    printUsage();
    return 0;
  }

  const filter: AuditFilter = {
    ...(values.tool !== undefined ? { tool: values.tool } : {}),
    ...(values.client !== undefined ? { client: values.client } : {}),
  };
  if (values.since !== undefined) {
    try {
      (filter as { sinceMs?: number }).sinceMs = cutoffBefore(values.since);
    } catch (err) {
      process.stderr.write(`peek audit log: ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  const path = auditLogPath();
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    process.stdout.write(`No audit log yet (${path}).\n`);
    return 0;
  }

  const { entries, errors } = parseAuditLog(contents);
  const matched = filterAuditEntries(entries, filter);

  if (values.json) {
    process.stdout.write(`${JSON.stringify(matched, null, 2)}\n`);
  } else if (matched.length === 0) {
    process.stdout.write('No matching audit entries.\n');
  } else {
    for (const e of matched) process.stdout.write(`${renderEntry(e)}\n`);
  }

  if (errors.length > 0) {
    process.stderr.write(
      `\npeek audit log: skipped ${errors.length} malformed line(s) (first at line ${errors[0]?.line}).\n`,
    );
  }
  return 0;
}
