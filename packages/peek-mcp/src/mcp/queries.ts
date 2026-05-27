// SQL read helpers for the MCP tools that hit structured tables directly
// (sessions, console_events, network_events). These mirror @peekdev/cli's
// db.ts shapes so a `peek sessions export --format json` and the MCP
// `get_session_*` tools return interchangeable data (P2 PRD §B3). The console /
// network rows are pre-extracted by the native host, so these are fast indexed
// reads — only the event-level tools fall back to the gzipped blob walker.

import type { Database } from 'better-sqlite3';

/** A row of `sessions` as the MCP tools present it (camelCase, PRD §B3 ids). */
export interface SessionSummaryRow {
  readonly id: string;
  readonly origin: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly errorCount: number;
  readonly eventCount: number;
}

interface RawSession {
  id: string;
  created_at: string;
  updated_at: string;
  url: string | null;
  title: string | null;
  origin: string | null;
  event_count: number;
  status: string;
}

/** Epoch-millis of an ISO-8601 timestamp; 0 if unparseable. */
function isoToMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function errorCountFor(db: Database, sessionId: string): number {
  const consoleErrors = (
    db
      .prepare("SELECT COUNT(*) AS c FROM console_events WHERE session_id = ? AND level = 'error'")
      .get(sessionId) as { c: number }
  ).c;
  const networkErrors = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM network_events WHERE session_id = ? AND (status >= 400 OR error_text IS NOT NULL)',
      )
      .get(sessionId) as { c: number }
  ).c;
  return consoleErrors + networkErrors;
}

function toSummaryRow(db: Database, r: RawSession): SessionSummaryRow {
  const startedAt = isoToMs(r.created_at);
  const endedAt = isoToMs(r.updated_at);
  return {
    id: r.id,
    origin: r.origin,
    url: r.url,
    title: r.title,
    startedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    errorCount: errorCountFor(db, r.id),
    eventCount: r.event_count,
  };
}

export interface ListSessionsOptions {
  readonly limit?: number;
  readonly origin?: string;
}

/**
 * List the most-recently-updated sessions, newest first (PRD §B3
 * `list_recent_sessions`). Default limit 10; capped to the schema's
 * `origin`-filtered subset when `origin` is given.
 */
export function listRecentSessions(
  db: Database,
  options: ListSessionsOptions = {},
): SessionSummaryRow[] {
  const limit = options.limit ?? 10;
  const params: Array<string | number> = [];
  let sql = 'SELECT * FROM sessions';
  if (options.origin !== undefined) {
    sql += ' WHERE origin = ?';
    params.push(options.origin);
  }
  sql += ' ORDER BY updated_at DESC, created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as RawSession[];
  return rows.map((r) => toSummaryRow(db, r));
}

/** One session's summary row, or undefined if no such id. */
export function getSessionSummaryRow(db: Database, id: string): SessionSummaryRow | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as RawSession | undefined;
  return row ? toSummaryRow(db, row) : undefined;
}

export interface ConsoleErrorRow {
  readonly id: number;
  readonly ts: number;
  readonly level: string;
  readonly message: string;
  readonly stack: string | null;
}

/**
 * Console error rows for a session, oldest first (PRD §B3
 * `get_session_console_errors`). `since` filters to ts >= it; default level
 * filter is `error` only (the tool name says "errors").
 */
export function getConsoleErrors(
  db: Database,
  id: string,
  options: { since?: number; limit?: number; level?: string } = {},
): ConsoleErrorRow[] {
  const limit = options.limit ?? 50;
  const params: Array<string | number> = [id];
  let sql = 'SELECT id, ts_ms, level, message, stack FROM console_events WHERE session_id = ?';
  if (options.level !== undefined) {
    sql += ' AND level = ?';
    params.push(options.level);
  } else {
    sql += " AND level = 'error'";
  }
  if (options.since !== undefined) {
    sql += ' AND ts_ms >= ?';
    params.push(options.since);
  }
  sql += ' ORDER BY ts_ms ASC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    ts_ms: number;
    level: string;
    message: string;
    stack: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts_ms,
    level: r.level,
    message: r.message,
    stack: r.stack,
  }));
}

export interface NetworkErrorRow {
  readonly id: number;
  readonly ts: number;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly statusText: string | null;
  readonly resourceType: string | null;
  readonly durationMs: number | null;
  readonly errorText: string | null;
}

/**
 * Failed/notable network rows for a session, oldest first (PRD §B3
 * `get_session_network_errors`). `statusGte` defaults to 400; rows with a
 * net-error string are always included.
 */
export function getNetworkErrors(
  db: Database,
  id: string,
  options: { statusGte?: number; limit?: number } = {},
): NetworkErrorRow[] {
  const statusGte = options.statusGte ?? 400;
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(
      `SELECT id, ts_ms, method, url, status, status_text, resource_type, duration_ms, error_text
         FROM network_events
        WHERE session_id = ? AND (status >= ? OR error_text IS NOT NULL)
        ORDER BY ts_ms ASC LIMIT ?`,
    )
    .all(id, statusGte, limit) as Array<{
    id: number;
    ts_ms: number;
    method: string;
    url: string;
    status: number | null;
    status_text: string | null;
    resource_type: string | null;
    duration_ms: number | null;
    error_text: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts_ms,
    method: r.method,
    url: r.url,
    status: r.status,
    statusText: r.status_text,
    resourceType: r.resource_type,
    durationMs: r.duration_ms,
    errorText: r.error_text,
  }));
}

/** Look up the events blob path + first-event ts for a session (for the walker tools). */
export function getSessionBlobRef(
  db: Database,
  id: string,
): { blobPath: string | null; startedAt: number } | undefined {
  const row = db
    .prepare('SELECT events_blob_path, created_at FROM sessions WHERE id = ?')
    .get(id) as { events_blob_path: string | null; created_at: string } | undefined;
  if (!row) return undefined;
  return { blobPath: row.events_blob_path, startedAt: isoToMs(row.created_at) };
}

/** The ts of a single console event id (used by get_user_action_before_error). */
export function getConsoleEventTs(db: Database, id: string, errorId: number): number | undefined {
  const row = db
    .prepare('SELECT ts_ms FROM console_events WHERE id = ? AND session_id = ?')
    .get(errorId, id) as { ts_ms: number } | undefined;
  return row?.ts_ms;
}
