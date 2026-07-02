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

/** Accurate `COUNT(*)` of error-level console rows for a session. */
export function countConsoleErrors(db: Database, sessionId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM console_events WHERE session_id = ? AND level = 'error'")
      .get(sessionId) as { c: number }
  ).c;
}

/** Accurate `COUNT(*)` of failed/notable network rows (status >= 400 or net error). */
export function countNetworkErrors(db: Database, sessionId: string): number {
  return (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM network_events WHERE session_id = ? AND (status >= 400 OR error_text IS NOT NULL)',
      )
      .get(sessionId) as { c: number }
  ).c;
}

function errorCountFor(db: Database, sessionId: string): number {
  return countConsoleErrors(db, sessionId) + countNetworkErrors(db, sessionId);
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

/** The full console error row for one id (the seed of a causal chain). */
export function getConsoleErrorById(
  db: Database,
  id: string,
  errorId: number,
): ConsoleErrorRow | undefined {
  const r = db
    .prepare(
      "SELECT id, ts_ms, level, message, stack FROM console_events WHERE id = ? AND session_id = ? AND level = 'error'",
    )
    .get(errorId, id) as
    | { id: number; ts_ms: number; level: string; message: string; stack: string | null }
    | undefined;
  return r
    ? { id: r.id, ts: r.ts_ms, level: r.level, message: r.message, stack: r.stack }
    : undefined;
}

/** Error-ish network rows (status >= statusGte OR error_text) within [fromTs, toTs], ascending by ts. */
export function getNetworkErrorsInWindow(
  db: Database,
  id: string,
  fromTs: number,
  toTs: number,
  options: { statusGte?: number; limit?: number } = {},
): NetworkErrorRow[] {
  const statusGte = options.statusGte ?? 400;
  const limit = options.limit ?? 200;
  const rows = db
    .prepare(
      `SELECT id, ts_ms, method, url, status, status_text, resource_type, duration_ms, error_text
         FROM network_events
        WHERE session_id = ? AND ts_ms >= ? AND ts_ms <= ? AND (status >= ? OR error_text IS NOT NULL)
        ORDER BY ts_ms ASC LIMIT ?`,
    )
    .all(id, fromTs, toTs, statusGte, limit) as Array<{
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

/** Escape LIKE metacharacters so a user term matches literally under ESCAPE '\'. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface SearchSessionsOptions extends ListSessionsOptions {
  readonly q?: string;
  readonly createdAfter?: string;
  readonly createdBefore?: string;
  /** Session lifecycle status. The schema's `status` column only ever holds these two values (see 0001_initial.sql). */
  readonly status?: 'active' | 'finalized';
  readonly hasConsoleErrors?: boolean;
  readonly hasNetworkErrors?: boolean;
}

/**
 * Search sessions by metadata + facets, newest first. Read-only; parameterized;
 * LIKE-based (no FTS). All options optional — empty returns recent sessions (a
 * superset of listRecentSessions). Returns the same SessionSummaryRow shape.
 */
export function searchSessions(
  db: Database,
  options: SearchSessionsOptions = {},
): SessionSummaryRow[] {
  const limit = options.limit ?? 10;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.q !== undefined && options.q !== '') {
    const like = `%${escapeLike(options.q)}%`;
    where.push("(title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR origin LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if (options.origin !== undefined) {
    where.push('origin = ?');
    params.push(options.origin);
  }
  if (options.createdAfter !== undefined) {
    where.push('created_at >= ?');
    params.push(options.createdAfter);
  }
  if (options.createdBefore !== undefined) {
    where.push('created_at <= ?');
    params.push(options.createdBefore);
  }
  if (options.status !== undefined) {
    where.push('status = ?');
    params.push(options.status);
  }
  if (options.hasConsoleErrors) {
    where.push(
      "EXISTS (SELECT 1 FROM console_events c WHERE c.session_id = sessions.id AND c.level = 'error')",
    );
  }
  if (options.hasNetworkErrors) {
    where.push(
      'EXISTS (SELECT 1 FROM network_events n WHERE n.session_id = sessions.id AND (n.status >= 400 OR n.error_text IS NOT NULL))',
    );
  }
  let sql = 'SELECT * FROM sessions';
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY updated_at DESC, created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as RawSession[];
  return rows.map((r) => toSummaryRow(db, r));
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
