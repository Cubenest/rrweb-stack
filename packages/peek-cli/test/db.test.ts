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
});
