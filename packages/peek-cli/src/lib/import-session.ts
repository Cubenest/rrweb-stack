import { randomUUID } from 'node:crypto';
// Write an unpacked *.peekbundle into the local store: the sessions row + console/
// network rows + the events re-encoded as ONE gzip chunk (seq 0) + its events_chunks
// index row. Replicates native-host/ingest.ts::ingestSessionAppend's transaction
// (no standalone writer is exported). H2.1.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Database } from 'better-sqlite3';
import { rrwebEventsDir } from './peek-home.js';
import type { UnpackedBundle } from './session-bundle.js';

export interface ImportOptions {
  /** true (default): mint a fresh id; false: keep originalSessionId. */
  newId: boolean;
  /** with newId:false, overwrite an existing session of the same id. */
  force?: boolean;
}

function eventTimeRange(events: unknown[]): { startMs: number; endMs: number } {
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    const ts = (e as { timestamp?: number }).timestamp;
    if (typeof ts === 'number') {
      if (ts < startMs) startMs = ts;
      if (ts > endMs) endMs = ts;
    }
  }
  if (!Number.isFinite(startMs)) startMs = 0;
  if (!Number.isFinite(endMs)) endMs = startMs;
  return { startMs, endMs };
}

/** Returns the id the session landed under. Throws on collision (see ImportOptions). */
export function importSessionBundle(db: Database, b: UnpackedBundle, opts: ImportOptions): string {
  const src = b.session.session as Record<string, unknown>;
  const targetId = opts.newId ? `s_${randomUUID().replace(/-/g, '')}` : String(src.id ?? '');
  if (targetId.length === 0) throw new Error('bundle session has no id');
  // SECURITY: with newId:false the kept id flows straight into
  // join(rrwebEventsDir(), targetId) for mkdir/write/rm. A malicious bundle
  // with id '../../evil' (or one carrying a path separator / NUL) would escape
  // the rrweb-events dir. Validate BEFORE any filesystem use. Minted ids are
  // always `s_<hex>` and always pass; this only ever fires on a kept id.
  if (
    /[/\\]/.test(targetId) ||
    targetId.split(/[/\\]/).includes('..') ||
    targetId.includes('\0') ||
    targetId === '.' ||
    targetId === '..'
  ) {
    throw new Error(
      `refusing to import: unsafe session id '${targetId}' (contains path separators or traversal)`,
    );
  }

  const exists = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(targetId);
  if (exists) {
    if (opts.newId) throw new Error(`minted id collision (rare): ${targetId}`);
    if (opts.force !== true)
      throw new Error(`session '${targetId}' already exists (use --force to overwrite)`);
    // Force overwrite: the row delete + on-disk blob removal happen BEFORE the
    // re-insert below and are deliberately NOT wrapped in one transaction. A crash
    // mid-overwrite drops the old session but is fully recoverable — this path is
    // user-initiated and re-runnable since the source bundle survives. Mirrors the
    // file-then-rows ordering rationale in native-host/ingest.ts.
    // Read the OLD row's stored blob path BEFORE the delete: it may differ from
    // the assumed <id> dir (legacy single `.gz` file, or a relative path under a
    // different name). loadSessionEvents supports both layouts, so removing only
    // the <id> dir would orphan the old captured blob on disk.
    const oldRow = db.prepare('SELECT events_blob_path FROM sessions WHERE id = ?').get(targetId) as
      | { events_blob_path: string | null }
      | undefined;
    db.prepare('DELETE FROM sessions WHERE id = ?').run(targetId);
    if (oldRow?.events_blob_path) {
      rmSync(join(rrwebEventsDir(), oldRow.events_blob_path), { recursive: true, force: true });
    }
    // Belt-and-suspenders for the common id == path case (and to clear the dir
    // we're about to re-create below).
    rmSync(join(rrwebEventsDir(), targetId), { recursive: true, force: true });
  }

  const gz = gzipSync(Buffer.from(JSON.stringify(b.events), 'utf8'));
  const { startMs, endMs } = eventTimeRange(b.events);
  const dir = join(rrwebEventsDir(), targetId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '0.json.gz'), gz);

  const nowIso = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, user_agent, events_blob_path, event_count, bytes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      targetId,
      String(src.created_at ?? nowIso),
      String(src.updated_at ?? nowIso),
      (src.url as string | null) ?? null,
      (src.title as string | null) ?? null,
      (src.origin as string | null) ?? null,
      (src.user_agent as string | null) ?? null,
      targetId,
      b.events.length,
      gz.length,
      String(src.status ?? 'finalized'),
    );
    db.prepare(
      `INSERT INTO events_chunks (session_id, seq, start_ts_ms, end_ts_ms, event_count, byte_offset, byte_length, created_at)
       VALUES (?, 0, ?, ?, ?, 0, ?, ?)`,
    ).run(targetId, startMs, endMs, b.events.length, gz.length, nowIso);

    const insC = db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message, stack, url) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const c of b.session.consoleEvents) {
      const r = c as Record<string, unknown>;
      insC.run(
        targetId,
        Number(r.ts_ms ?? 0),
        String(r.level ?? 'log'),
        String(r.message ?? ''),
        (r.stack as string | null) ?? null,
        (r.url as string | null) ?? null,
      );
    }

    const insN = db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status, status_text, request_id, resource_type, duration_ms, error_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const n of b.session.networkEvents) {
      const r = n as Record<string, unknown>;
      insN.run(
        targetId,
        Number(r.ts_ms ?? 0),
        String(r.method ?? 'GET'),
        String(r.url ?? ''),
        (r.status as number | null) ?? null,
        (r.status_text as string | null) ?? null,
        (r.request_id as string | null) ?? null,
        (r.resource_type as string | null) ?? null,
        (r.duration_ms as number | null) ?? null,
        (r.error_text as string | null) ?? null,
      );
    }
  });
  tx();
  return targetId;
}
