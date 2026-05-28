// Native-host ingest pipeline (Task #44 — capture-loop closure).
//
// The SW already builds the four message types defined in
// `peek-extension/src/background/native-protocol.ts`. This module turns them
// into:
//   - `~/.peek/rrweb-events/<sessionId>/<seq>.json.gz` chunk blobs
//   - `events_chunks` index rows (path + byte range)
//   - `console_events` / `network_events` rows
//   - a `sessions` upsert keyed by sessionId
//
// Per ADR-0007 the SQLite DB stores ONLY pointers + extracted rows; the rrweb
// event bodies live on disk in gzipped chunks so the DB file stays small and
// queryable. The chunk file's path is recorded in `events_chunks.byte_offset
// = 0`, `byte_length = file_size`; we treat each chunk as its own gzip member,
// not a concatenated stream, which keeps appends trivially crash-safe.
//
// Hardening: every public entry point returns a structured reply (never
// throws). A FK error, a malformed shape, or a disk full doesn't tear down the
// host loop — the SW gets a `.err` reply and retries (per the SW's contract
// the host loop survives).

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Database } from 'better-sqlite3';

/** Per-host runtime context (the open DB + the home directory for blobs). */
export interface IngestContext {
  readonly db: Database;
  /** Base for `<home>/rrweb-events/<sessionId>/<seq>.json.gz`. */
  readonly home: string;
}

// ---------------------------------------------------------------------------
// Wire shapes — these mirror peek-extension/src/background/native-protocol.ts
// EXACTLY. The host MUST NOT mutate them; the SW is the source of truth for
// the field names + shapes. This file re-declares the structural shapes (not a
// cross-package import — the host's only contact with the extension is over
// the native-messaging wire).
// ---------------------------------------------------------------------------

export interface IncomingSessionAppend {
  readonly type: 'session.append';
  readonly sessionId: string;
  readonly url?: string;
  readonly title?: string;
  readonly events: readonly unknown[];
  /** Optional client-stamped seq for idempotent retries. Server assigns when omitted. */
  readonly seq?: number;
}

export interface IncomingConsoleEvent {
  readonly ts: number;
  readonly level: string;
  readonly args: readonly string[];
}

export interface IncomingConsoleAppend {
  readonly type: 'console.append';
  readonly sessionId: string;
  readonly url?: string;
  readonly title?: string;
  readonly events: readonly IncomingConsoleEvent[];
}

export interface IncomingNetRecord {
  readonly kind: 'request' | 'response' | 'error';
  readonly id: string;
  readonly ts: number;
  readonly url?: string;
  readonly method?: string;
  readonly status?: number;
  readonly transport?: 'fetch' | 'xhr';
  readonly error?: string;
  /**
   * Deep capture (ADR-0010, PRD §A.8): the relay's `maskNetMessage` runs
   * `redactBody` in the ISOLATED world and forwards the masked string here.
   * Shape mirrors `NetMessage.requestBody` / `responseBody` in
   * peek-extension/src/recorder/messages.ts. Absent for Basic capture,
   * `request` records that carried no body, and `error` records.
   */
  readonly requestBody?: string;
  readonly responseBody?: string;
}

export interface IncomingNetworkAppend {
  readonly type: 'network.append';
  readonly sessionId: string;
  readonly url?: string;
  readonly title?: string;
  readonly records: readonly IncomingNetRecord[];
}

export interface IncomingShadowReport {
  readonly type: 'shadow.report';
  readonly sessionId: string;
  readonly reports: readonly unknown[];
}

export type IncomingMessage =
  | IncomingSessionAppend
  | IncomingConsoleAppend
  | IncomingNetworkAppend
  | IncomingShadowReport;

// ---------------------------------------------------------------------------
// Reply shapes — the SW treats `*.ok` as success and any other reply as a nack
// to be retried (don't break that contract).
// ---------------------------------------------------------------------------

export interface OkReply<T extends string> {
  readonly type: `${T}.ok`;
  readonly sessionId?: string;
  readonly seq?: number;
  readonly count?: number;
}

export interface ErrReply<T extends string> {
  readonly type: `${T}.err`;
  readonly sessionId?: string;
  readonly code: string;
  readonly detail?: string;
}

export type IngestReply =
  | OkReply<'session.append'>
  | ErrReply<'session.append'>
  | OkReply<'console.append'>
  | ErrReply<'console.append'>
  | OkReply<'network.append'>
  | ErrReply<'network.append'>
  | OkReply<'shadow.report'>
  | ErrReply<'shadow.report'>
  | ErrReply<'ingest'>;

/** Absolute path to the rrweb-events chunk store under PEEK_HOME. */
export function rrwebEventsDir(home: string): string {
  return join(home, 'rrweb-events');
}

/**
 * Dispatch one ingest message to the appropriate handler. Pure with respect to
 * the network: takes a context, returns a reply. Every error path returns a
 * structured `.err` reply — never throws.
 */
export function ingest(message: IncomingMessage, ctx: IngestContext): IngestReply {
  try {
    switch (message.type) {
      case 'session.append':
        return ingestSessionAppend(message, ctx);
      case 'console.append':
        return ingestConsoleAppend(message, ctx);
      case 'network.append':
        return ingestNetworkAppend(message, ctx);
      case 'shadow.report':
        return ingestShadowReport(message, ctx);
      default: {
        const type = (message as { type?: string }).type ?? '(none)';
        return {
          type: 'ingest.err',
          code: 'unknown_type',
          detail: `no handler for message type '${type}'`,
        } as ErrReply<'ingest'>;
      }
    }
  } catch (err) {
    // Defense in depth: any uncaught throw from a handler becomes a structured
    // error reply rather than tearing down the host loop.
    return {
      type: 'ingest.err',
      code: 'handler_threw',
      detail: err instanceof Error ? err.message : String(err),
    } as ErrReply<'ingest'>;
  }
}

// ---------------------------------------------------------------------------
// session.append
// ---------------------------------------------------------------------------

function ingestSessionAppend(
  msg: IncomingSessionAppend,
  ctx: IngestContext,
): OkReply<'session.append'> | ErrReply<'session.append'> {
  if (typeof msg.sessionId !== 'string' || msg.sessionId.length === 0) {
    return {
      type: 'session.append.err',
      code: 'missing_session_id',
      detail: 'session.append requires sessionId',
    };
  }
  if (!Array.isArray(msg.events) || msg.events.length === 0) {
    return {
      type: 'session.append.err',
      sessionId: msg.sessionId,
      code: 'empty_events',
      detail: 'session.append requires at least one event',
    };
  }

  const { startMs, endMs } = eventTimeRange(msg.events);
  const nowIso = new Date().toISOString();

  // Choose a seq: client-stamped (idempotent retry) or auto-incremented.
  const nextSeqRow = ctx.db
    .prepare('SELECT IFNULL(MAX(seq), -1) + 1 AS next FROM events_chunks WHERE session_id = ?')
    .get(msg.sessionId) as { next: number };
  const seq = msg.seq ?? nextSeqRow.next;

  // Encode the chunk body to disk first, then index it in the DB. Order
  // matters: a crash AFTER the file write but BEFORE the row insert leaves an
  // orphan file (recoverable: a recovery pass can re-walk the dir + re-index).
  // A crash AFTER the row insert but BEFORE the file write would leave a
  // dangling pointer the reader would 404 on — strictly worse.
  const body = Buffer.from(JSON.stringify(msg.events), 'utf8');
  const gz = gzipSync(body);

  const dir = join(rrwebEventsDir(ctx.home), msg.sessionId);
  mkdirSync(dir, { recursive: true });
  const blobPath = join(dir, `${seq}.json.gz`);
  writeFileSync(blobPath, gz);
  const fileBytes = gz.length;

  // Upsert the parent session, then INSERT OR IGNORE the chunk row, then
  // accumulate event_count + bytes — all in one transaction so a retry of a
  // dup seq doesn't double-count and a partial failure rolls back.
  const origin = msg.url ? safeOrigin(msg.url) : undefined;
  const upsertSession = ctx.db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, event_count, bytes, events_blob_path)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       url = COALESCE(excluded.url, sessions.url),
       title = COALESCE(excluded.title, sessions.title),
       origin = COALESCE(excluded.origin, sessions.origin)`,
  );
  const insertChunk = ctx.db.prepare(
    `INSERT OR IGNORE INTO events_chunks
       (session_id, seq, start_ts_ms, end_ts_ms, event_count, byte_offset, byte_length, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  );
  const accumulateSession = ctx.db.prepare(
    `UPDATE sessions
        SET event_count = event_count + ?,
            bytes = bytes + ?,
            updated_at = ?
      WHERE id = ?`,
  );

  const tx = ctx.db.transaction(() => {
    upsertSession.run(
      msg.sessionId,
      nowIso,
      nowIso,
      msg.url ?? null,
      msg.title ?? null,
      origin ?? null,
      // events_blob_path stays a per-session pointer label; chunk rows carry the per-seq path.
      // We record the session-level directory (relative to PEEK_HOME) on first insert via the
      // `?` placeholder above; the INSERT-OR-IGNORE on conflict won't update it (intentional).
      join('rrweb-events', msg.sessionId),
    );
    const ins = insertChunk.run(
      msg.sessionId,
      seq,
      startMs,
      endMs,
      msg.events.length,
      fileBytes,
      nowIso,
    );
    if (ins.changes > 0) {
      // Only accumulate when we actually inserted (a duplicate seq is a no-op).
      accumulateSession.run(msg.events.length, fileBytes, nowIso, msg.sessionId);
    }
  });
  tx();

  return { type: 'session.append.ok', sessionId: msg.sessionId, seq };
}

// ---------------------------------------------------------------------------
// console.append
// ---------------------------------------------------------------------------

function ingestConsoleAppend(
  msg: IncomingConsoleAppend,
  ctx: IngestContext,
): OkReply<'console.append'> | ErrReply<'console.append'> {
  if (typeof msg.sessionId !== 'string' || msg.sessionId.length === 0) {
    return {
      type: 'console.append.err',
      code: 'missing_session_id',
      detail: 'console.append requires sessionId',
    };
  }
  const events = Array.isArray(msg.events) ? msg.events : [];
  if (events.length === 0) {
    return { type: 'console.append.ok', sessionId: msg.sessionId, count: 0 };
  }

  ensureSessionRow(ctx.db, msg.sessionId, msg.url, msg.title);

  const insert = ctx.db.prepare(
    'INSERT INTO console_events (session_id, ts_ms, level, message, url) VALUES (?, ?, ?, ?, ?)',
  );
  const tx = ctx.db.transaction((rows: readonly IncomingConsoleEvent[]) => {
    for (const ev of rows) {
      const ts = typeof ev.ts === 'number' ? ev.ts : Date.now();
      const level = typeof ev.level === 'string' && ev.level.length > 0 ? ev.level : 'log';
      const args = Array.isArray(ev.args) ? ev.args : [];
      // The args[] array is the masked, already-stringified console arg list
      // (see peek-extension/src/relay/mask.ts). Joining matches the rrweb
      // console-plugin's natural format (one logical line per call).
      const message = args.join(' ');
      insert.run(msg.sessionId, ts, level, message, msg.url ?? null);
    }
  });
  tx(events);
  return { type: 'console.append.ok', sessionId: msg.sessionId, count: events.length };
}

// ---------------------------------------------------------------------------
// network.append
// ---------------------------------------------------------------------------

function ingestNetworkAppend(
  msg: IncomingNetworkAppend,
  ctx: IngestContext,
): OkReply<'network.append'> | ErrReply<'network.append'> {
  if (typeof msg.sessionId !== 'string' || msg.sessionId.length === 0) {
    return {
      type: 'network.append.err',
      code: 'missing_session_id',
      detail: 'network.append requires sessionId',
    };
  }
  const records = Array.isArray(msg.records) ? msg.records : [];
  if (records.length === 0) {
    return { type: 'network.append.ok', sessionId: msg.sessionId, count: 0 };
  }

  ensureSessionRow(ctx.db, msg.sessionId, msg.url, msg.title);

  // Deep capture (ADR-0010): the relay-side mask runs `redactBody` BEFORE the
  // body arrives here, so we just persist the already-masked string. Unset
  // fields land as SQL NULL (not the literal "undefined" / empty string).
  const insert = ctx.db.prepare(
    `INSERT INTO network_events
       (session_id, ts_ms, method, url, status, status_text, request_id, resource_type, duration_ms, error_text, request_body_redacted, response_body_redacted)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
  );
  const tx = ctx.db.transaction((rows: readonly IncomingNetRecord[]) => {
    for (const rec of rows) {
      const ts = typeof rec.ts === 'number' ? rec.ts : Date.now();
      const method =
        typeof rec.method === 'string' ? rec.method : rec.kind === 'request' ? 'GET' : 'GET';
      const url = typeof rec.url === 'string' ? rec.url : '';
      const status = typeof rec.status === 'number' ? rec.status : null;
      const requestId = typeof rec.id === 'string' ? rec.id : null;
      const resourceType = typeof rec.transport === 'string' ? rec.transport : null;
      const errorText = typeof rec.error === 'string' ? rec.error : null;
      const requestBody = typeof rec.requestBody === 'string' ? rec.requestBody : null;
      const responseBody = typeof rec.responseBody === 'string' ? rec.responseBody : null;
      insert.run(
        msg.sessionId,
        ts,
        method,
        url,
        status,
        requestId,
        resourceType,
        errorText,
        requestBody,
        responseBody,
      );
    }
  });
  tx(records);
  return { type: 'network.append.ok', sessionId: msg.sessionId, count: records.length };
}

// ---------------------------------------------------------------------------
// shadow.report — deferred persistence (Phase 4)
// ---------------------------------------------------------------------------

function ingestShadowReport(
  msg: IncomingShadowReport,
  _ctx: IngestContext,
): OkReply<'shadow.report'> | ErrReply<'shadow.report'> {
  if (typeof msg.sessionId !== 'string' || msg.sessionId.length === 0) {
    return {
      type: 'shadow.report.err',
      code: 'missing_session_id',
      detail: 'shadow.report requires sessionId',
    };
  }
  const count = Array.isArray(msg.reports) ? msg.reports.length : 0;
  // Reconnaissance shape — not a primary capture type. Persisted shape decision
  // is deferred to Phase 4. For now we just log + acknowledge.
  console.warn(`peek native host: shadow.report ack — ${count} report(s) for ${msg.sessionId}`);
  return { type: 'shadow.report.ok', sessionId: msg.sessionId, count };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Ensure the parent `sessions` row exists (FK target) before inserting children. */
function ensureSessionRow(
  db: Database,
  sessionId: string,
  url: string | undefined,
  title: string | undefined,
): void {
  const origin = url ? safeOrigin(url) : undefined;
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, url, title, origin)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       url = COALESCE(excluded.url, sessions.url),
       title = COALESCE(excluded.title, sessions.title),
       origin = COALESCE(excluded.origin, sessions.origin)`,
  ).run(sessionId, nowIso, nowIso, url ?? null, title ?? null, origin ?? null);
}

/** Min / max timestamp across an events batch. Defaults to now() for empty/missing. */
function eventTimeRange(events: readonly unknown[]): { startMs: number; endMs: number } {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const ev of events) {
    const ts = readTimestamp(ev);
    if (ts === null) continue;
    if (ts < startMs) startMs = ts;
    if (ts > endMs) endMs = ts;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    const now = Date.now();
    return { startMs: now, endMs: now };
  }
  return { startMs, endMs };
}

function readTimestamp(ev: unknown): number | null {
  if (typeof ev !== 'object' || ev === null) return null;
  const ts = (ev as { timestamp?: unknown }).timestamp;
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

// Internal helper exported for future test coverage of file size accounting.
export function _chunkFileSize(home: string, sessionId: string, seq: number): number {
  const path = join(rrwebEventsDir(home), sessionId, `${seq}.json.gz`);
  return statSync(path).size;
}
