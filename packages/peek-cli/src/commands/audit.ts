// `peek audit log [--since <dur>] [--tool <name>] [--client <name>]` command
// shell (Task 3.10, ADR-0010 / P2 PRD §H3). Reads ~/.peek/audit.log (JSONL),
// runs the pure parse + filter, and prints. The native host / extension write
// the log; the CLI only reads it.

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

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: peek audit log [options]',
      '',
      'Options:',
      '  --since <dur>     Only entries newer than e.g. 1h, 30m, 7d',
      '  --tool <name>     Filter by tool (e.g. execute_action)',
      '  --client <name>   Filter by MCP client (e.g. cursor, claude-code)',
      '  --json            Emit matching entries as JSON instead of a table',
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
export function runAudit(argv: string[]): number {
  const sub = argv[0];
  if (sub !== 'log') {
    if (sub === undefined || sub === 'help' || sub === '--help' || sub === '-h') {
      printUsage();
      return sub === undefined ? 1 : 0;
    }
    process.stderr.write(`peek audit: unknown subcommand '${sub}' (did you mean 'log'?)\n`);
    return 1;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      since: { type: 'string' },
      tool: { type: 'string' },
      client: { type: 'string' },
      json: { type: 'boolean' },
    },
    allowPositionals: false,
  });

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
