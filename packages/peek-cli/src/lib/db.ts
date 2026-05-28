// Read-mostly query helpers over the native host's ~/.peek/sessions.db. The CLI
// opens the same SQLite file through @peekdev/mcp's `openDb` (WAL + FK pragmas,
// migration state) — it never reimplements the DB layer (ADR-0007). The native
// host writes; the CLI lists / shows / exports / deletes.
//
// The returned shapes deliberately mirror the MCP tool return schema (P2 PRD
// §B3) so `peek sessions export --format json` and the MCP `get_session_*`
// tools are interchangeable for an AI consumer.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { rrwebEventsDir } from './peek-home.js';

/** A row of the `sessions` table, as the CLI presents it. */
export interface SessionRow {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url: string | null;
  readonly title: string | null;
  readonly origin: string | null;
  readonly userAgent: string | null;
  readonly eventCount: number;
  readonly bytes: number;
  readonly status: string;
}

/** A console message extracted for a session (mirrors `get_session_console_errors`). */
export interface ConsoleEventRow {
  readonly ts: number;
  readonly level: string;
  readonly message: string;
  readonly stack: string | null;
  readonly url: string | null;
}

/** A network request captured for a session (mirrors `get_session_network_errors`). */
export interface NetworkEventRow {
  readonly ts: number;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly statusText: string | null;
  readonly resourceType: string | null;
  readonly durationMs: number | null;
  readonly errorText: string | null;
}

/** Per-session aggregate counts used by `peek sessions list` / the summary header. */
export interface SessionCounts {
  readonly consoleErrors: number;
  readonly networkErrors: number;
}

/** A fully-hydrated session for `show` / `export` (metadata + extracted rows). */
export interface SessionDetail {
  readonly session: SessionRow;
  readonly counts: SessionCounts;
  readonly consoleErrors: ConsoleEventRow[];
  readonly networkErrors: NetworkEventRow[];
}

interface RawSessionRow {
  id: string;
  created_at: string;
  updated_at: string;
  url: string | null;
  title: string | null;
  origin: string | null;
  user_agent: string | null;
  event_count: number;
  bytes: number;
  status: string;
}

function mapSession(r: RawSessionRow): SessionRow {
  return {
    id: r.id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    url: r.url,
    title: r.title,
    origin: r.origin,
    userAgent: r.user_agent,
    eventCount: r.event_count,
    bytes: r.bytes,
    status: r.status,
  };
}

export interface ListSessionsOptions {
  /** Max rows (default 20, per P2 PRD §C.1). */
  readonly limit?: number;
  /** Filter to a single origin (`scheme://host[:port]`). */
  readonly origin?: string;
}

/**
 * List the most-recently-updated sessions, newest first. Default limit 20
 * (P2 PRD §C.1 `peek sessions list [--origin <url>] [--limit 20]`).
 */
export function listSessions(db: Database, options: ListSessionsOptions = {}): SessionRow[] {
  const limit = options.limit ?? 20;
  const params: Array<string | number> = [];
  let sql = 'SELECT * FROM sessions';
  if (options.origin !== undefined) {
    sql += ' WHERE origin = ?';
    params.push(options.origin);
  }
  sql += ' ORDER BY updated_at DESC, created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as RawSessionRow[];
  return rows.map(mapSession);
}

/** Fetch one session's metadata, or `undefined` if no such id. */
export function getSession(db: Database, id: string): SessionRow | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | RawSessionRow
    | undefined;
  return row ? mapSession(row) : undefined;
}

/** Count error-level console rows and >=400 network rows for a session. */
export function getSessionCounts(db: Database, id: string): SessionCounts {
  const consoleErrors = (
    db
      .prepare("SELECT COUNT(*) AS c FROM console_events WHERE session_id = ? AND level = 'error'")
      .get(id) as { c: number }
  ).c;
  const networkErrors = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM network_events WHERE session_id = ? AND (status >= 400 OR error_text IS NOT NULL)',
      )
      .get(id) as { c: number }
  ).c;
  return { consoleErrors, networkErrors };
}

export interface ConsoleQueryOptions {
  /** Only `level = 'error'` rows (the default for export/summary). */
  readonly errorsOnly?: boolean;
  /** Max rows (default 50, mirrors the MCP tool). */
  readonly limit?: number;
}

/** Console messages for a session, oldest first. */
export function getConsoleEvents(
  db: Database,
  id: string,
  options: ConsoleQueryOptions = {},
): ConsoleEventRow[] {
  const limit = options.limit ?? 50;
  let sql = 'SELECT ts_ms, level, message, stack, url FROM console_events WHERE session_id = ?';
  if (options.errorsOnly) sql += " AND level = 'error'";
  sql += ' ORDER BY ts_ms ASC LIMIT ?';
  const rows = db.prepare(sql).all(id, limit) as Array<{
    ts_ms: number;
    level: string;
    message: string;
    stack: string | null;
    url: string | null;
  }>;
  return rows.map((r) => ({
    ts: r.ts_ms,
    level: r.level,
    message: r.message,
    stack: r.stack,
    url: r.url,
  }));
}

export interface NetworkQueryOptions {
  /** Minimum HTTP status to include (default 400 — failures only). */
  readonly statusGte?: number;
  /** Max rows (default 50). */
  readonly limit?: number;
}

/** Failed/notable network requests for a session, oldest first. */
export function getNetworkEvents(
  db: Database,
  id: string,
  options: NetworkQueryOptions = {},
): NetworkEventRow[] {
  const statusGte = options.statusGte ?? 400;
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(
      `SELECT ts_ms, method, url, status, status_text, resource_type, duration_ms, error_text
         FROM network_events
        WHERE session_id = ? AND (status >= ? OR error_text IS NOT NULL)
        ORDER BY ts_ms ASC LIMIT ?`,
    )
    .all(id, statusGte, limit) as Array<{
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

/** Hydrate one session fully for `show` / `export`. Returns `undefined` if no such id. */
export function getSessionDetail(db: Database, id: string): SessionDetail | undefined {
  const session = getSession(db, id);
  if (!session) return undefined;
  return {
    session,
    counts: getSessionCounts(db, id),
    consoleErrors: getConsoleEvents(db, id, { errorsOnly: true }),
    networkErrors: getNetworkEvents(db, id),
  };
}

/**
 * Delete one session by id. Child rows cascade (ON DELETE CASCADE). Also
 * removes the per-session chunk directory under {@link rrwebEventsDir} — K.4
 * fix (2026-05-28 QA walk): the DB cascade alone left gzipped blobs on disk
 * forever. Returns rows removed (0 or 1). `rrwebBaseDir` defaults to
 * `~/.peek/rrweb-events/`; tests override it with a tmpdir.
 */
export function deleteSession(
  db: Database,
  id: string,
  rrwebBaseDir: string = rrwebEventsDir(),
): number {
  const info = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  if (info.changes > 0) {
    rmSync(join(rrwebBaseDir, id), { recursive: true, force: true });
  }
  return info.changes;
}

/**
 * Delete every session whose `updated_at` is strictly before the ISO cutoff
 * AND the corresponding per-session chunk directories on disk. SELECT-then-
 * DELETE wraps in a transaction so the on-disk cleanup matches what was
 * actually removed from the DB even if a concurrent write lands between the
 * two statements. Returns the number of sessions removed.
 */
export function deleteSessionsOlderThan(
  db: Database,
  cutoffIso: string,
  rrwebBaseDir: string = rrwebEventsDir(),
): number {
  const removeIds = db.transaction((cutoff: string): readonly string[] => {
    const rows = db.prepare('SELECT id FROM sessions WHERE updated_at < ?').all(cutoff) as {
      id: string;
    }[];
    db.prepare('DELETE FROM sessions WHERE updated_at < ?').run(cutoff);
    return rows.map((r) => r.id);
  });
  const ids = removeIds(cutoffIso);
  for (const id of ids) {
    rmSync(join(rrwebBaseDir, id), { recursive: true, force: true });
  }
  return ids.length;
}
