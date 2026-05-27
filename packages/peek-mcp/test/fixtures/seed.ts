// Seed a temp ~/.peek store for the MCP server integration tests: a writable
// SQLite DB (created + migrated via the same openDb the native host uses) plus
// gzipped rrweb event blobs written under an events dir, exactly as the native
// host would persist them (ADR-0007). The server-under-test then opens the DB
// read-only and reads the blobs through its normal paths.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compress, type eventWithTime } from '@cubenest/rrweb-core';
import { openDb } from '../../src/db/open.js';

export interface SeededSession {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly url?: string;
  readonly title?: string;
  readonly origin?: string;
  /** Decoded events to gzip into the blob (omit for a session with no blob). */
  readonly events?: eventWithTime[];
  readonly consoleErrors?: Array<{ ts: number; message: string; stack?: string; level?: string }>;
  readonly networkErrors?: Array<{
    ts: number;
    method: string;
    url: string;
    status?: number;
    errorText?: string;
  }>;
}

export interface SeededStore {
  readonly dbPath: string;
  readonly eventsDir: string;
}

/**
 * Write a DB + blobs into `homeDir` for the given sessions, returning the
 * paths the server options need. Console-error ids are assigned in insert
 * order so tests can reference them via get_session_console_errors.
 */
export function seedStore(homeDir: string, sessions: SeededSession[]): SeededStore {
  const dbPath = join(homeDir, 'sessions.db');
  const eventsDir = join(homeDir, 'rrweb-events');
  mkdirSync(eventsDir, { recursive: true });

  const db = openDb({ path: dbPath });
  try {
    for (const s of sessions) {
      let blobPath: string | null = null;
      let eventCount = 0;
      let bytes = 0;
      if (s.events) {
        const gz = compress(s.events);
        blobPath = `${s.id}.rrweb.gz`;
        writeFileSync(join(eventsDir, blobPath), gz);
        eventCount = s.events.length;
        bytes = gz.byteLength;
      }
      db.prepare(
        `INSERT INTO sessions
           (id, created_at, updated_at, url, title, origin, events_blob_path, event_count, bytes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalized')`,
      ).run(
        s.id,
        s.createdAt,
        s.updatedAt,
        s.url ?? null,
        s.title ?? null,
        s.origin ?? null,
        blobPath,
        eventCount,
        bytes,
      );

      for (const c of s.consoleErrors ?? []) {
        db.prepare(
          'INSERT INTO console_events (session_id, ts_ms, level, message, stack) VALUES (?, ?, ?, ?, ?)',
        ).run(s.id, c.ts, c.level ?? 'error', c.message, c.stack ?? null);
      }
      for (const n of s.networkErrors ?? []) {
        db.prepare(
          'INSERT INTO network_events (session_id, ts_ms, method, url, status, error_text) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(s.id, n.ts, n.method, n.url, n.status ?? null, n.errorText ?? null);
      }
    }
  } finally {
    db.close();
  }

  return { dbPath, eventsDir };
}
