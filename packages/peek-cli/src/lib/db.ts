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
import { parseDuration } from './duration.js';
import { rrwebEventsDir } from './peek-home.js';
import type { RetentionPolicy } from './retention.js';

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
  /**
   * Relative path to the gzipped event blob under ~/.peek/rrweb-events/.
   * Null when the session has never flushed (active session pre-flush) or
   * pre-dates the column. Consumed by the playwright export (K.2 alpha.7)
   * to feed the rrweb stream to `generate_playwright_repro`.
   */
  readonly eventsBlobPath: string | null;
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
  events_blob_path: string | null;
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
    eventsBlobPath: r.events_blob_path,
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

/** A list row enriched with the per-session aggregate error counts (P-18 fix). */
export interface SessionRowWithCounts extends SessionRow {
  /** Console rows with level = 'error' (matches getSessionCounts.consoleErrors). */
  readonly consoleCount: number;
  /** Network rows with status >= 400 OR error_text IS NOT NULL (matches networkErrors). */
  readonly networkCount: number;
}

/**
 * List sessions WITH the per-row console + network error counts in a SINGLE
 * query (P-18 alpha.8 fix). The `peek sessions list --json` path needs the
 * counts on each row — they're the most actionable signal for an AI consumer
 * deciding which session to drill into. The naive approach (call
 * `getSessionCounts` per row) is N+1: 2 child-table queries × default 20 rows
 * = 40 queries per list. This LEFT JOIN aggregates both child tables in one
 * statement; both have an existing `(session_id, …)` index (migration 0001:
 * `idx_console_events_session` + `idx_network_events_session`) so the join
 * stays sub-millisecond on thousands of sessions.
 *
 * Error definitions MUST match {@link getSessionCounts} exactly — otherwise
 * `peek sessions list --json` and `peek sessions show <id>` would disagree on
 * how many errors a session has, which would confuse downstream tooling.
 *   console error  := level = 'error'
 *   network error  := status >= 400 OR error_text IS NOT NULL
 */
export function listSessionsWithCounts(
  db: Database,
  options: ListSessionsOptions = {},
): SessionRowWithCounts[] {
  const limit = options.limit ?? 20;
  const params: Array<string | number> = [];
  // The two correlated COUNT(*) subqueries inline are simpler than two LEFT
  // JOINs against derived tables AND let SQLite use the (session_id, ...)
  // indexes for each row directly. With LIMIT applied to the outer query the
  // subqueries run at most `limit` times per side — bounded the same way the
  // naive N+1 was, but in one statement (no JS-side loop, no per-row prepare).
  let sql = `
    SELECT
      s.*,
      (SELECT COUNT(*) FROM console_events
        WHERE session_id = s.id AND level = 'error') AS console_count,
      (SELECT COUNT(*) FROM network_events
        WHERE session_id = s.id AND (status >= 400 OR error_text IS NOT NULL)) AS network_count
    FROM sessions s
  `;
  if (options.origin !== undefined) {
    sql += ' WHERE s.origin = ?';
    params.push(options.origin);
  }
  sql += ' ORDER BY s.updated_at DESC, s.created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Array<
    RawSessionRow & { console_count: number; network_count: number }
  >;
  return rows.map((r) => ({
    ...mapSession(r),
    consoleCount: r.console_count,
    networkCount: r.network_count,
  }));
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

/**
 * A network row for the full-fidelity bundle export. Unlike {@link NetworkEventRow}
 * this also carries `requestId` (the `request_id` column the importer round-trips).
 */
export interface NetworkExportRow {
  readonly ts: number;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly statusText: string | null;
  readonly requestId: string | null;
  readonly resourceType: string | null;
  readonly durationMs: number | null;
  readonly errorText: string | null;
}

/**
 * EVERY network row for a session, oldest first — no status filter, no row cap.
 * The bundle export must round-trip the full session faithfully, so it cannot
 * use {@link getNetworkEvents} (which drops NULL-status + NULL-error rows like
 * pending requests, caps at 50, and never selects `request_id`).
 */
export function getAllNetworkEvents(db: Database, id: string): NetworkExportRow[] {
  const rows = db
    .prepare(
      `SELECT ts_ms, method, url, status, status_text, request_id, resource_type, duration_ms, error_text
         FROM network_events
        WHERE session_id = ?
        ORDER BY ts_ms ASC`,
    )
    .all(id) as Array<{
    ts_ms: number;
    method: string;
    url: string;
    status: number | null;
    status_text: string | null;
    request_id: string | null;
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
    requestId: r.request_id,
    resourceType: r.resource_type,
    durationMs: r.duration_ms,
    errorText: r.error_text,
  }));
}

/**
 * EVERY console row for a session, oldest first — no level filter, no row cap.
 * Full-fidelity counterpart to {@link getConsoleEvents} for the bundle export.
 */
export function getAllConsoleEvents(db: Database, id: string): ConsoleEventRow[] {
  const rows = db
    .prepare(
      `SELECT ts_ms, level, message, stack, url
         FROM console_events
        WHERE session_id = ?
        ORDER BY ts_ms ASC`,
    )
    .all(id) as Array<{
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

/**
 * Escape SQLite LIKE special characters (`%`, `_`, `\`) so a user-supplied
 * query string is treated as a literal substring match. Use with
 * `LIKE ? ESCAPE '\'`.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface SearchSessionsOptions extends ListSessionsOptions {
  /** Case-insensitive substring match against title, url, and origin. */
  readonly q?: string;
  /** ISO timestamp lower bound on created_at (inclusive). */
  readonly createdAfter?: string;
  /** ISO timestamp upper bound on created_at (inclusive). */
  readonly createdBefore?: string;
  /** Session lifecycle status. The schema's `status` column only ever holds these two values (see 0001_initial.sql). */
  readonly status?: 'active' | 'finalized';
  /** Restrict to sessions that have at least one console error row. */
  readonly hasConsoleErrors?: boolean;
  /** Restrict to sessions that have at least one network error row. */
  readonly hasNetworkErrors?: boolean;
  /** Restrict to sessions with console OR network errors (the CLI `--errors any`). */
  readonly errorsAny?: boolean;
}

const CONSOLE_ERR_EXISTS =
  "EXISTS (SELECT 1 FROM console_events WHERE session_id = s.id AND level = 'error')";
const NETWORK_ERR_EXISTS =
  'EXISTS (SELECT 1 FROM network_events WHERE session_id = s.id AND (status >= 400 OR error_text IS NOT NULL))';

/**
 * Search sessions by metadata + facets (with error counts), newest first.
 *
 * Mirrors the shape of {@link listSessionsWithCounts} but adds a full set of
 * filter knobs: free-text `q` (LIKE across title/url/origin), date range,
 * status, and error-presence flags. All filters compose with AND; empty
 * options returns the 20 most-recently-updated sessions (same default as
 * `listSessionsWithCounts`). Read-only; fully parameterized; LIKE-escaped.
 */
export function searchSessions(
  db: Database,
  options: SearchSessionsOptions = {},
): SessionRowWithCounts[] {
  const limit = options.limit ?? 20;
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (options.q !== undefined && options.q !== '') {
    const like = `%${escapeLike(options.q)}%`;
    where.push(
      "(s.title LIKE ? ESCAPE '\\' OR s.url LIKE ? ESCAPE '\\' OR s.origin LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like);
  }
  if (options.origin !== undefined) {
    where.push('s.origin = ?');
    params.push(options.origin);
  }
  if (options.createdAfter !== undefined) {
    where.push('s.created_at >= ?');
    params.push(options.createdAfter);
  }
  if (options.createdBefore !== undefined) {
    where.push('s.created_at <= ?');
    params.push(options.createdBefore);
  }
  if (options.status !== undefined) {
    where.push('s.status = ?');
    params.push(options.status);
  }
  if (options.errorsAny) {
    where.push(`(${CONSOLE_ERR_EXISTS} OR ${NETWORK_ERR_EXISTS})`);
  } else {
    if (options.hasConsoleErrors) where.push(CONSOLE_ERR_EXISTS);
    if (options.hasNetworkErrors) where.push(NETWORK_ERR_EXISTS);
  }

  let sql = `
    SELECT s.*,
      (SELECT COUNT(*) FROM console_events WHERE session_id = s.id AND level = 'error') AS console_count,
      (SELECT COUNT(*) FROM network_events WHERE session_id = s.id AND (status >= 400 OR error_text IS NOT NULL)) AS network_count
    FROM sessions s`;
  if (where.length > 0) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY s.updated_at DESC, s.created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as Array<
    RawSessionRow & { console_count: number; network_count: number }
  >;
  return rows.map((r) => ({
    ...mapSession(r),
    consoleCount: r.console_count,
    networkCount: r.network_count,
  }));
}

/** Total on-disk event bytes summed across all sessions. */
export function sumSessionBytes(db: Database): number {
  const row = db.prepare('SELECT COALESCE(SUM(bytes), 0) AS total FROM sessions').get() as {
    total: number;
  };
  return row.total;
}

/**
 * Delete the given sessions: rows (children CASCADE; audit_log SET NULL) in one transaction,
 * then rmSync each blob dir after the transaction (mirrors deleteSession's discipline).
 * Returns the number of session rows removed.
 */
export function pruneSessions(
  db: Database,
  ids: readonly string[],
  rrwebBaseDir: string = rrwebEventsDir(),
): number {
  if (ids.length === 0) return 0;
  const removeIds = db.transaction((toRemove: readonly string[]): number => {
    const del = db.prepare('DELETE FROM sessions WHERE id = ?');
    let changes = 0;
    for (const id of toRemove) changes += del.run(id).changes;
    return changes;
  });
  const deleted = removeIds(ids);
  for (const id of ids) {
    rmSync(join(rrwebBaseDir, id), { recursive: true, force: true });
  }
  return deleted;
}

export interface PruneCandidate {
  readonly id: string;
  readonly updatedAt: string;
  readonly bytes: number;
  /** Why this session was selected — 'age' and/or 'disk'. */
  readonly reasons: readonly ('age' | 'disk')[];
}

interface PruneRow {
  id: string;
  updated_at: string;
  bytes: number;
  status: string;
}

/**
 * Decide which sessions a policy would prune. Pure read (no deletion). Single source of
 * truth for both `preview` and `apply`. Loads the full session list (small) and decides
 * in-memory, so no index/migration is needed.
 */
export function selectPruneCandidates(
  db: Database,
  policy: RetentionPolicy,
  nowMs: number = Date.now(),
  opts: { includeStaleActive?: boolean } = {},
): PruneCandidate[] {
  const rows = db
    .prepare('SELECT id, updated_at, bytes, status FROM sessions ORDER BY updated_at DESC, id DESC')
    .all() as PruneRow[];

  // keepLast floor: rows are DESC, so the first N are the most-recent — protected.
  const keep = policy.keepLast ?? 0;
  const protectedIds = new Set(rows.slice(0, keep).map((r) => r.id));

  let ageCutoffIso: string | undefined;
  if (policy.maxAge !== undefined) {
    const cutoffMs = nowMs - parseDuration(policy.maxAge);
    if (!Number.isFinite(cutoffMs) || cutoffMs < -8_640_000_000_000_000) {
      throw new Error(`maxAge "${policy.maxAge}" is too large`);
    }
    ageCutoffIso = new Date(cutoffMs).toISOString();
  }

  // Eligible pool: not protected; active excluded unless includeStaleActive AND past the age cutoff.
  const eligible = rows.filter((r) => {
    if (protectedIds.has(r.id)) return false;
    if (r.status === 'active') {
      if (!opts.includeStaleActive) return false;
      if (ageCutoffIso === undefined || r.updated_at >= ageCutoffIso) return false;
    }
    return true;
  });

  const reasons = new Map<string, Set<'age' | 'disk'>>();
  const mark = (id: string, why: 'age' | 'disk'): void => {
    const set = reasons.get(id) ?? new Set<'age' | 'disk'>();
    set.add(why);
    reasons.set(id, set);
  };

  // Age rule.
  if (ageCutoffIso !== undefined) {
    for (const r of eligible) {
      if (r.updated_at < ageCutoffIso) mark(r.id, 'age');
    }
  }

  // Disk rule: total over ALL sessions minus those already age-pruned; evict oldest eligible
  // (protected + non-stale-active count toward the total but are never evicted).
  if (policy.maxSizeBytes !== undefined) {
    let total = rows.reduce((sum, r) => sum + (reasons.has(r.id) ? 0 : r.bytes), 0);
    if (total > policy.maxSizeBytes) {
      const oldestFirst = eligible.filter((r) => !reasons.has(r.id)).reverse();
      for (const r of oldestFirst) {
        if (total <= policy.maxSizeBytes) break;
        mark(r.id, 'disk');
        total -= r.bytes;
      }
    }
  }

  // Build candidates oldest-first (rows are DESC → reverse).
  return rows
    .filter((r) => reasons.has(r.id))
    .reverse()
    .map((r) => ({
      id: r.id,
      updatedAt: r.updated_at,
      bytes: r.bytes,
      reasons: [...(reasons.get(r.id) ?? new Set<'age' | 'disk'>())],
    }));
}
