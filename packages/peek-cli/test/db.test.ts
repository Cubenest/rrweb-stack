import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteSession, deleteSessionsOlderThan, getSession, listSessions } from '../src/lib/db.js';

let db: Database;

function seed(id: string, updatedAt: string, origin = 'https://example.com'): void {
  db.prepare('INSERT INTO sessions (id, created_at, updated_at, origin) VALUES (?, ?, ?, ?)').run(
    id,
    updatedAt,
    updatedAt,
    origin,
  );
}

beforeEach(() => {
  db = openDb({ path: ':memory:' });
});

afterEach(() => {
  db.close();
});

describe('deleteSession', () => {
  it('removes one session by id and reports 1', () => {
    seed('s_keep', '2026-05-26T00:00:00.000Z');
    seed('s_drop', '2026-05-26T00:00:00.000Z');
    expect(deleteSession(db, 's_drop')).toBe(1);
    expect(getSession(db, 's_drop')).toBeUndefined();
    expect(getSession(db, 's_keep')).toBeDefined();
  });

  it('reports 0 for an unknown id', () => {
    expect(deleteSession(db, 's_nope')).toBe(0);
  });

  it('cascades to child rows (ON DELETE CASCADE)', () => {
    seed('s_1', '2026-05-26T00:00:00.000Z');
    db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message) VALUES (?, ?, ?, ?)',
    ).run('s_1', Date.now(), 'error', 'boom');
    expect(deleteSession(db, 's_1')).toBe(1);
    const remaining = db
      .prepare('SELECT COUNT(*) AS c FROM console_events WHERE session_id = ?')
      .get('s_1') as { c: number };
    expect(remaining.c).toBe(0);
  });

  // K.4 (2026-05-28 QA walk): pre-fix, deleteSession dropped the DB row but
  // left ~/.peek/rrweb-events/<id>/*.json.gz on disk forever. Every delete
  // leaked the gzipped chunks. These tests pin the FS cascade.
  it('also removes the session chunk directory under rrwebBaseDir (K.4 fix)', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'peek-cli-k4-'));
    try {
      seed('s_with_chunks', '2026-05-26T00:00:00.000Z');
      const chunkDir = join(baseDir, 's_with_chunks');
      mkdirSync(chunkDir, { recursive: true });
      writeFileSync(join(chunkDir, '0.json.gz'), Buffer.from('fake-gz'));
      writeFileSync(join(chunkDir, '1.json.gz'), Buffer.from('fake-gz'));

      expect(deleteSession(db, 's_with_chunks', baseDir)).toBe(1);
      expect(existsSync(chunkDir)).toBe(false);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('does not touch the chunk dir when the session id is unknown (no DB row → no FS rm)', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'peek-cli-k4-'));
    try {
      // Pre-existing chunk dir from a stale state — peek did NOT just delete
      // anything; we should not nuke this without a DB match.
      const orphanDir = join(baseDir, 's_nope');
      mkdirSync(orphanDir, { recursive: true });
      writeFileSync(join(orphanDir, '0.json.gz'), Buffer.from('fake-gz'));

      expect(deleteSession(db, 's_nope', baseDir)).toBe(0);
      expect(existsSync(orphanDir)).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('tolerates a missing chunk dir (force:true silently no-ops)', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'peek-cli-k4-'));
    try {
      seed('s_no_chunks', '2026-05-26T00:00:00.000Z');
      // Sessions row exists but no chunk dir on disk (e.g., recording was
      // interrupted before any append landed). Delete must not throw.
      expect(deleteSession(db, 's_no_chunks', baseDir)).toBe(1);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe('deleteSessionsOlderThan', () => {
  it('deletes only rows strictly older than the cutoff, keeping the boundary row', () => {
    seed('s_old', '2026-05-01T00:00:00.000Z');
    const boundary = '2026-05-20T00:00:00.000Z';
    seed('s_boundary', boundary); // updated_at === cutoff: must NOT be deleted (< ? is strict)
    seed('s_new', '2026-05-26T00:00:00.000Z');

    const removed = deleteSessionsOlderThan(db, boundary);

    expect(removed).toBe(1);
    expect(getSession(db, 's_old')).toBeUndefined();
    expect(getSession(db, 's_boundary')).toBeDefined();
    expect(getSession(db, 's_new')).toBeDefined();
    const ids = listSessions(db)
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(['s_boundary', 's_new']);
  });

  it('deletes nothing when all rows are newer than the cutoff', () => {
    seed('s_a', '2026-05-26T00:00:00.000Z');
    seed('s_b', '2026-05-27T00:00:00.000Z');
    expect(deleteSessionsOlderThan(db, '2026-01-01T00:00:00.000Z')).toBe(0);
    expect(listSessions(db)).toHaveLength(2);
  });

  it('cascades child rows of deleted sessions', () => {
    seed('s_old', '2026-05-01T00:00:00.000Z');
    db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES (?, ?, ?, ?, ?)',
    ).run('s_old', Date.now(), 'GET', 'https://example.com', 500);
    deleteSessionsOlderThan(db, '2026-05-20T00:00:00.000Z');
    const remaining = db
      .prepare('SELECT COUNT(*) AS c FROM network_events WHERE session_id = ?')
      .get('s_old') as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('removes chunk dirs only for the deleted sessions, leaving newer ones intact (K.4)', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'peek-cli-k4-'));
    try {
      seed('s_old_1', '2026-05-01T00:00:00.000Z');
      seed('s_old_2', '2026-05-05T00:00:00.000Z');
      seed('s_new', '2026-05-26T00:00:00.000Z');
      for (const id of ['s_old_1', 's_old_2', 's_new']) {
        mkdirSync(join(baseDir, id), { recursive: true });
        writeFileSync(join(baseDir, id, '0.json.gz'), Buffer.from('fake-gz'));
      }

      const removed = deleteSessionsOlderThan(db, '2026-05-20T00:00:00.000Z', baseDir);

      expect(removed).toBe(2);
      expect(existsSync(join(baseDir, 's_old_1'))).toBe(false);
      expect(existsSync(join(baseDir, 's_old_2'))).toBe(false);
      expect(existsSync(join(baseDir, 's_new'))).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
