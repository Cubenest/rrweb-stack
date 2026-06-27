// `peek sessions <list|show|export|delete>` command shell (Task 3.8, P2 PRD
// §C.1). Opens the shared DB read-mostly via @peekdev/mcp's openDb, runs the
// pure query/format helpers, and prints / writes. Arg parsing uses the built-in
// node:util parseArgs (no dependency).
//
// P-18 (alpha.7): every subcommand's parseArgs call MUST declare `--help` as a
// known option. Pre-fix, passing `--help` to a subcommand crashed with
// `TypeError: Unknown option '--help'` because node:util parseArgs rejects
// unknown flags by default. Each subcommand now defines its own `printHelp`
// (so the usage matches the subcommand's actual options) and `--help` short-
// circuits to exit 0 before any other work. `list` also adds `--json` for
// machine-readable output (audit log already has it; show/export/delete
// don't need it — show is interactive, export writes its own format-
// controlled file, delete is unary).

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from '@peekdev/mcp/db';
import { loadSessionEvents } from '@peekdev/mcp/mcp/event-blobs';
import type { Database } from 'better-sqlite3';
import {
  deleteSession,
  deleteSessionsOlderThan,
  getConsoleEvents,
  getNetworkEvents,
  getSession,
  getSessionDetail,
  listSessions,
  listSessionsWithCounts,
} from '../lib/db.js';
import { cutoffBefore } from '../lib/duration.js';
import {
  EXPORT_FORMATS,
  type ExportFormat,
  formatSession,
  isExportFormat,
} from '../lib/format/index.js';
import { importSessionBundle } from '../lib/import-session.js';
import { formatBytes, pad } from '../lib/output.js';
import { defaultDbPath, rrwebEventsDir } from '../lib/peek-home.js';
import {
  FULLSNAPSHOT_CAVEAT,
  packBundle,
  unpackBundle,
  verifyBundle,
} from '../lib/session-bundle.js';

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
      '  list [--origin <url>] [--limit 20] [--json]   List recent sessions (newest first)',
      '  show <session-id>                              Show one session (metadata + errors)',
      `  export <session-id> --format <${EXPORT_FORMATS.join('|')}> [--out <file>]`,
      '  import <bundle-file> [--keep-id] [--force]    Import a *.peekbundle into the local store',
      '  delete <session-id>                            Delete one session',
      '  delete --all-older-than <dur>                  Delete sessions older than e.g. 7d',
      '',
      "Run 'peek sessions <command> --help' for command-specific options.",
      '',
    ].join('\n'),
  );
}

function printListHelp(): void {
  process.stdout.write(
    [
      'Usage: peek sessions list [options]',
      '',
      'Options:',
      '  --origin <url>   Filter to a single origin (scheme://host[:port])',
      '  --limit <n>      Max rows to return (default 20, must be > 0)',
      '  --json           Emit rows as a JSON array instead of a table',
      '  --help           Show this help and exit',
      '',
    ].join('\n'),
  );
}

function printShowHelp(): void {
  process.stdout.write(
    [
      'Usage: peek sessions show <session-id>',
      '',
      'Print one session as Markdown (the same shape `--format markdown` exports).',
      '',
      'Options:',
      '  --help   Show this help and exit',
      '',
    ].join('\n'),
  );
}

function printExportHelp(): void {
  process.stdout.write(
    [
      'Usage: peek sessions export <session-id> [options]',
      '',
      'Options:',
      `  --format <${EXPORT_FORMATS.join('|')}>   Export format (default: markdown)`,
      '  --out <file>                              Write to file instead of stdout',
      '  --help                                    Show this help and exit',
      '',
      'Formats:',
      '  markdown    Structured AI-paste (default)',
      '  json        Machine-readable, same schema as the MCP get_session_* tools',
      '  playwright  Runnable Playwright `test(...)` script (K.2 alpha.7)',
      '  bundle      Portable *.peekbundle archive (events + rows + integrity hash)',
      '  html        Self-contained replay viewer (deferred — see --help error)',
      '',
    ].join('\n'),
  );
}

function printImportHelp(): void {
  process.stdout.write(
    [
      'Usage: peek sessions import <bundle-file> [options]',
      '',
      'Import a *.peekbundle archive (created by `peek sessions export --format bundle`)',
      'into the local session store. Integrity is verified before anything is written.',
      '',
      'Options:',
      '  --keep-id   Keep the original session id from the bundle (default: mint a new id)',
      '  --force     With --keep-id: overwrite an existing session of the same id',
      '  --help      Show this help and exit',
      '',
    ].join('\n'),
  );
}

/**
 * Binary bundle import — reads a *.peekbundle, verifies its integrity (fails
 * closed on tampered/corrupt bundles), then writes the session into the local
 * store via importSessionBundle. By default mints a new id so importing the
 * same bundle twice is safe.
 */
function runImport(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'keep-id': { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    printImportHelp();
    return 0;
  }
  const file = positionals[0];
  if (!file) {
    process.stderr.write('peek sessions import: missing <bundle-file>\n');
    return 1;
  }
  let bundle: ReturnType<typeof unpackBundle>;
  try {
    bundle = unpackBundle(file);
    verifyBundle(bundle);
  } catch (err) {
    process.stderr.write(
      `peek sessions import: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  const db = open();
  try {
    const id = importSessionBundle(db, bundle, {
      newId: values['keep-id'] !== true,
      force: values.force === true,
    });
    process.stdout.write(`Imported session ${id} (run: peek sessions show ${id})\n`);
    return 0;
  } catch (err) {
    process.stderr.write(
      `peek sessions import: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    db.close();
  }
}

/**
 * Binary bundle export — writes a gzipped tar (*.peekbundle) containing the
 * session metadata rows, all console/network events, and the raw rrweb event
 * stream. Bypasses `formatSession` (which returns a string); this path writes a
 * file directly and never streams binary to stdout.
 */
function runBundleExport(id: string, out: string | undefined): number {
  const db = open();
  try {
    const session = getSession(db, id);
    if (!session) {
      process.stderr.write(`peek sessions export: no session with id '${id}'\n`);
      return 1;
    }
    const blobPath = session.eventsBlobPath ?? id;
    const events = loadSessionEvents(blobPath, rrwebEventsDir());
    // The bundle must carry EVERY stored row, not the triage subset the MCP
    // tools surface: getConsoleEvents defaults to limit=50, getNetworkEvents
    // defaults to statusGte=400 (failures only) + limit=50. Lift both filters
    // so an export round-trips the full session (statusGte=0 keeps successful
    // requests; the high limit defeats the row cap).
    const ALL_ROWS = 1_000_000;
    const consoleRows = getConsoleEvents(db, id, { errorsOnly: false, limit: ALL_ROWS });
    const networkRows = getNetworkEvents(db, id, { statusGte: 0, limit: ALL_ROWS });
    const outPath = out ?? `${id}.peekbundle`;
    // db.ts returns camelCase rows; the bundle's canonical shape is snake_case
    // (matching the DB columns + import-session.ts's reads). Map explicitly —
    // a blind `as unknown as` cast would ship camelCase keys the importer can't
    // read, silently resetting created_at/user_agent/ts_ms/status_text on import.
    packBundle(outPath, {
      session: {
        id: session.id,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        url: session.url,
        title: session.title,
        origin: session.origin,
        user_agent: session.userAgent,
        status: session.status,
      },
      consoleEvents: consoleRows.map((c) => ({
        ts_ms: c.ts,
        level: c.level,
        message: c.message,
        stack: c.stack,
        url: c.url,
      })),
      networkEvents: networkRows.map((n) => ({
        ts_ms: n.ts,
        method: n.method,
        url: n.url,
        status: n.status,
        status_text: n.statusText,
        resource_type: n.resourceType,
        duration_ms: n.durationMs,
        error_text: n.errorText,
      })),
      events,
    });
    process.stderr.write(`${FULLSNAPSHOT_CAVEAT}\n`);
    process.stdout.write(`Wrote ${outPath}\n`);
    return 0;
  } finally {
    db.close();
  }
}

function printDeleteHelp(): void {
  process.stdout.write(
    [
      'Usage: peek sessions delete <session-id>',
      '       peek sessions delete --all-older-than <duration>',
      '',
      'Options:',
      '  --all-older-than <dur>   Delete every session older than e.g. 7d, 24h, 30m',
      '  --help                   Show this help and exit',
      '',
    ].join('\n'),
  );
}

/**
 * A single JSON row for `peek sessions list --json`. Spec (P-18 alpha.7) calls
 * for: id, origin, url, created_at, updated_at, event_count, console_count,
 * network_count. `console_count` + `network_count` are the most actionable
 * signal for AI consumers — they answer "which session is worth investigating"
 * without a drill-in round-trip. Definitions match `getSessionCounts` exactly
 * (console errors = level='error'; network errors = status >= 400 OR error_text
 * non-null) so JSON list + `peek sessions show` agree on the numbers.
 *
 * `bytes` + `status` are kept (not in spec, not prohibited) — they're already
 * in the `sessions` row and help triage active vs idle sessions at zero query
 * cost.
 *
 * Field names: snake_case to match the DB column shapes (peek audit log --json
 * does likewise) — the closer machine-readable output stays to the SQL row,
 * the less translation a downstream tool has to do.
 */
interface SessionListJsonRow {
  readonly id: string;
  readonly origin: string | null;
  readonly url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly event_count: number;
  readonly console_count: number;
  readonly network_count: number;
  readonly bytes: number;
  readonly status: string;
}

function runList(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      origin: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    printListHelp();
    return 0;
  }
  const limit = values.limit !== undefined ? Number(values.limit) : 20;
  if (!Number.isInteger(limit) || limit <= 0) {
    process.stderr.write('peek sessions list: --limit must be a positive integer\n');
    return 1;
  }

  const db = open();
  try {
    const listOpts = {
      limit,
      ...(values.origin !== undefined ? { origin: values.origin } : {}),
    };
    if (values.json) {
      // Machine-readable path: pull the count-enriched rows in a single
      // query (avoids N+1 on the list path — see listSessionsWithCounts).
      // Always emit a JSON array (empty when no sessions), never the
      // "No sessions recorded yet." human string. Downstream scripts can
      // `JSON.parse` the output unconditionally.
      const rows = listSessionsWithCounts(db, listOpts);
      const json: SessionListJsonRow[] = rows.map((s) => ({
        id: s.id,
        origin: s.origin,
        url: s.url,
        created_at: s.createdAt,
        updated_at: s.updatedAt,
        event_count: s.eventCount,
        console_count: s.consoleCount,
        network_count: s.networkCount,
        bytes: s.bytes,
        status: s.status,
      }));
      process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
      return 0;
    }
    // Human table path: counts aren't shown (see `peek sessions show` for
    // the drill-in view), so the cheaper `listSessions` is fine.
    const rows = listSessions(db, listOpts);
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
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    printShowHelp();
    return 0;
  }
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
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    printExportHelp();
    return 0;
  }
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

  if (format === 'bundle') {
    return runBundleExport(id, values.out);
  }

  const db = open();
  try {
    const detail = getSessionDetail(db, id);
    if (!detail) {
      process.stderr.write(`peek sessions export: no session with id '${id}'\n`);
      return 1;
    }
    const result = formatSession(detail, format, {
      ...(detail.session.eventsBlobPath !== null
        ? { blobPath: detail.session.eventsBlobPath }
        : {}),
    });
    if (!result.ok) {
      // html stub: clear message, non-zero exit (never write a partial file).
      // playwright wired through in alpha.7 (K.2); json/markdown always ok.
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
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) {
    printDeleteHelp();
    return 0;
  }
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
    case 'import':
      return runImport(rest);
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
