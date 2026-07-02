import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeLike, searchSessions } from '../src/lib/db.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      url TEXT, title TEXT, origin TEXT, user_agent TEXT, events_blob_path TEXT,
      event_count INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE console_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      ts_ms INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, stack TEXT, url TEXT);
    CREATE TABLE network_events (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      ts_ms INTEGER NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, status INTEGER,
      status_text TEXT, request_id TEXT, resource_type TEXT, duration_ms INTEGER, error_text TEXT);
  `);
  return db;
}
function addSession(
  db: Database.Database,
  s: Partial<{
    id: string;
    created_at: string;
    updated_at: string;
    url: string;
    title: string;
    origin: string;
    status: string;
  }>,
): void {
  db.prepare(
    'INSERT INTO sessions (id, created_at, updated_at, url, title, origin, status) VALUES (@id,@created_at,@updated_at,@url,@title,@origin,@status)',
  ).run({
    id: s.id ?? 's1',
    created_at: s.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: s.updated_at ?? s.created_at ?? '2026-01-01T00:00:00Z',
    url: s.url ?? null,
    title: s.title ?? null,
    origin: s.origin ?? null,
    status: s.status ?? 'finalized',
  });
}

let db: Database.Database;
beforeEach(() => {
  db = freshDb();
});

describe('escapeLike', () => {
  it('escapes % _ and backslash', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});

describe('searchSessions (cli)', () => {
  it('matches q against title/url/origin and returns counts', () => {
    addSession(db, { id: 's1', title: 'Checkout Flow' });
    addSession(db, { id: 's2', title: 'Home' });
    db.prepare(
      "INSERT INTO console_events (session_id, ts_ms, level, message) VALUES ('s1', 1, 'error', 'x')",
    ).run();
    const r = searchSessions(db, { q: 'checkout' });
    expect(r.map((x) => x.id)).toEqual(['s1']);
    expect(r[0]?.consoleCount).toBe(1);
  });
  it('escapes % in q (literal)', () => {
    addSession(db, { id: 's1', title: '100% done' });
    addSession(db, { id: 's2', title: '100 done' });
    expect(searchSessions(db, { q: '100%' }).map((x) => x.id)).toEqual(['s1']);
  });
  it('filters origin / date range / status', () => {
    addSession(db, {
      id: 'a',
      origin: 'https://a.test',
      created_at: '2026-01-01T00:00:00Z',
      status: 'active',
    });
    addSession(db, {
      id: 'b',
      origin: 'https://b.test',
      created_at: '2026-06-01T00:00:00Z',
      status: 'finalized',
    });
    expect(searchSessions(db, { origin: 'https://a.test' }).map((x) => x.id)).toEqual(['a']);
    expect(searchSessions(db, { createdAfter: '2026-03-01T00:00:00Z' }).map((x) => x.id)).toEqual([
      'b',
    ]);
    expect(searchSessions(db, { status: 'active' }).map((x) => x.id)).toEqual(['a']);
  });
  it('hasConsoleErrors / hasNetworkErrors / errorsAny', () => {
    addSession(db, { id: 'c' });
    addSession(db, { id: 'n' });
    addSession(db, { id: 'clean' });
    db.prepare(
      "INSERT INTO console_events (session_id, ts_ms, level, message) VALUES ('c', 1, 'error', 'x')",
    ).run();
    db.prepare(
      "INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES ('n', 1, 'GET', 'u', 500)",
    ).run();
    expect(searchSessions(db, { hasConsoleErrors: true }).map((x) => x.id)).toEqual(['c']);
    expect(searchSessions(db, { hasNetworkErrors: true }).map((x) => x.id)).toEqual(['n']);
    expect(
      searchSessions(db, { errorsAny: true })
        .map((x) => x.id)
        .sort(),
    ).toEqual(['c', 'n']);
  });
  it('limit + empty=recent (newest first)', () => {
    addSession(db, { id: 'a', updated_at: '2026-01-01T00:00:00Z' });
    addSession(db, { id: 'b', updated_at: '2026-02-01T00:00:00Z' });
    expect(searchSessions(db, {}).map((x) => x.id)).toEqual(['b', 'a']);
    expect(searchSessions(db, { limit: 1 }).map((x) => x.id)).toEqual(['b']);
  });
});
