// `peek sessions <list|show|export|delete>` command shell (Task 3.8, P2 PRD
// §C.1). Opens the shared DB read-mostly via @peekdev/mcp's openDb, runs the
// pure query/format helpers, and prints / writes. Arg parsing uses the built-in
// node:util parseArgs (no dependency).

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from '@peekdev/mcp/db';
import type { Database } from 'better-sqlite3';
import {
  deleteSession,
  deleteSessionsOlderThan,
  getSessionDetail,
  listSessions,
} from '../lib/db.js';
import { cutoffBefore } from '../lib/duration.js';
import {
  EXPORT_FORMATS,
  type ExportFormat,
  formatSession,
  isExportFormat,
} from '../lib/format/index.js';
import { formatBytes, pad } from '../lib/output.js';
import { defaultDbPath } from '../lib/peek-home.js';

/** Open the shared DB for reading (migrations applied so a fresh DB is valid). */
function open(): Database {
  return openDb({ path: defaultDbPath() });
}

function printUsage(): void {
  process.stdout.write(
    [
      'Usage: peek sessions <command>',
      '',
      'Commands:',
      '  list [--origin <url>] [--limit 20]   List recent sessions (newest first)',
      '  show <session-id>                    Show one session (metadata + errors)',
      `  export <session-id> --format <${EXPORT_FORMATS.join('|')}> [--out <file>]`,
      '  delete <session-id>                  Delete one session',
      '  delete --all-older-than <dur>        Delete sessions older than e.g. 7d',
      '',
    ].join('\n'),
  );
}

function runList(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      origin: { type: 'string' },
      limit: { type: 'string' },
    },
    allowPositionals: false,
  });
  const limit = values.limit !== undefined ? Number(values.limit) : 20;
  if (!Number.isInteger(limit) || limit <= 0) {
    process.stderr.write('peek sessions list: --limit must be a positive integer\n');
    return 1;
  }

  const db = open();
  try {
    const rows = listSessions(db, {
      limit,
      ...(values.origin !== undefined ? { origin: values.origin } : {}),
    });
    if (rows.length === 0) {
      process.stdout.write('No sessions recorded yet.\n');
      return 0;
    }
    process.stdout.write(
      `${pad('ID', 22)}${pad('UPDATED', 26)}${pad('EVENTS', 9)}${pad('SIZE', 11)}ORIGIN\n`,
    );
    for (const s of rows) {
      process.stdout.write(
        `${pad(s.id, 22)}${pad(s.updatedAt, 26)}${pad(String(s.eventCount), 9)}${pad(
          formatBytes(s.bytes),
          11,
        )}${s.origin ?? '(unknown)'}\n`,
      );
    }
    return 0;
  } finally {
    db.close();
  }
}

function runShow(argv: string[]): number {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const id = positionals[0];
  if (!id) {
    process.stderr.write('peek sessions show: missing <session-id>\n');
    return 1;
  }
  const db = open();
  try {
    const detail = getSessionDetail(db, id);
    if (!detail) {
      process.stderr.write(`peek sessions show: no session with id '${id}'\n`);
      return 1;
    }
    // `show` reuses the markdown formatter — it's the human + AI-readable view.
    const result = formatSession(detail, 'markdown');
    if (result.ok) process.stdout.write(result.content);
    return 0;
  } finally {
    db.close();
  }
}

function runExport(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      format: { type: 'string' },
      out: { type: 'string' },
    },
    allowPositionals: true,
  });
  const id = positionals[0];
  if (!id) {
    process.stderr.write('peek sessions export: missing <session-id>\n');
    return 1;
  }
  const formatRaw = values.format ?? 'markdown';
  if (!isExportFormat(formatRaw)) {
    process.stderr.write(
      `peek sessions export: invalid --format '${formatRaw}' (expected ${EXPORT_FORMATS.join('|')})\n`,
    );
    return 1;
  }
  const format: ExportFormat = formatRaw;

  const db = open();
  try {
    const detail = getSessionDetail(db, id);
    if (!detail) {
      process.stderr.write(`peek sessions export: no session with id '${id}'\n`);
      return 1;
    }
    const result = formatSession(detail, format);
    if (!result.ok) {
      // html / playwright stubs: clear message, non-zero exit (never write a
      // partial file).
      process.stderr.write(`peek sessions export: ${result.message}\n`);
      return 2;
    }
    if (values.out !== undefined) {
      writeFileSync(values.out, result.content, 'utf8');
      process.stdout.write(`Wrote ${format} export to ${values.out}\n`);
    } else {
      process.stdout.write(result.content);
    }
    return 0;
  } finally {
    db.close();
  }
}

function runDelete(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'all-older-than': { type: 'string' },
    },
    allowPositionals: true,
  });
  const olderThan = values['all-older-than'];
  const id = positionals[0];

  if (olderThan !== undefined && id !== undefined) {
    process.stderr.write('peek sessions delete: pass either <session-id> OR --all-older-than\n');
    return 1;
  }

  const db = open();
  try {
    if (olderThan !== undefined) {
      let cutoffIso: string;
      try {
        const cutoffMs = cutoffBefore(olderThan);
        // parseDuration accepts any integer, so a huge duration (e.g. `17200000w`)
        // yields a finite-but-out-of-range cutoff; `new Date(...).toISOString()`
        // would throw RangeError. Guard before converting (the JS Date floor is
        // -8.64e15 ms) so the failure is a clean message, not a stack trace.
        if (!Number.isFinite(cutoffMs) || cutoffMs < -8_640_000_000_000_000) {
          process.stderr.write(`peek sessions delete: duration '${olderThan}' is too large\n`);
          return 1;
        }
        cutoffIso = new Date(cutoffMs).toISOString();
      } catch (err) {
        process.stderr.write(
          `peek sessions delete: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return 1;
      }
      const removed = deleteSessionsOlderThan(db, cutoffIso);
      process.stdout.write(`Deleted ${removed} session(s) older than ${olderThan}.\n`);
      return 0;
    }
    if (id === undefined) {
      process.stderr.write('peek sessions delete: missing <session-id> or --all-older-than\n');
      return 1;
    }
    const removed = deleteSession(db, id);
    if (removed === 0) {
      process.stderr.write(`peek sessions delete: no session with id '${id}'\n`);
      return 1;
    }
    process.stdout.write(`Deleted session ${id}.\n`);
    return 0;
  } finally {
    db.close();
  }
}

/** Entry for `peek sessions ...`; `argv` excludes the `sessions` token. */
export function runSessions(argv: string[]): number {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'list':
      return runList(rest);
    case 'show':
      return runShow(rest);
    case 'export':
      return runExport(rest);
    case 'delete':
      return runDelete(rest);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return sub === undefined ? 1 : 0;
    default:
      process.stderr.write(`peek sessions: unknown subcommand '${sub}'\n`);
      printUsage();
      return 1;
  }
}
