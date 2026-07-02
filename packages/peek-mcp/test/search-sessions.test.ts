import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { escapeLike, searchSessions } from '../src/mcp/queries.js';

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

describe('searchSessions', () => {
  it('matches q against title/url/origin (case-insensitive)', () => {
    addSession(db, { id: 's1', title: 'Checkout Flow', origin: 'https://acme.test' });
    addSession(db, { id: 's2', title: 'Home', origin: 'https://other.test' });
    expect(searchSessions(db, { q: 'checkout' }).map((x) => x.id)).toEqual(['s1']);
  });
  it('treats % in q as a literal (escaped), not a wildcard', () => {
    addSession(db, { id: 's1', title: '100% done' });
    addSession(db, { id: 's2', title: '100 done' });
    expect(searchSessions(db, { q: '100%' }).map((x) => x.id)).toEqual(['s1']);
  });
  it('filters by origin exactly', () => {
    addSession(db, { id: 's1', origin: 'https://acme.test' });
    addSession(db, { id: 's2', origin: 'https://other.test' });
    expect(searchSessions(db, { origin: 'https://acme.test' }).map((x) => x.id)).toEqual(['s1']);
  });
  it('filters by created_at range', () => {
    addSession(db, { id: 'old', created_at: '2026-01-01T00:00:00Z' });
    addSession(db, { id: 'new', created_at: '2026-06-01T00:00:00Z' });
    expect(searchSessions(db, { createdAfter: '2026-03-01T00:00:00Z' }).map((x) => x.id)).toEqual([
      'new',
    ]);
    expect(searchSessions(db, { createdBefore: '2026-03-01T00:00:00Z' }).map((x) => x.id)).toEqual([
      'old',
    ]);
  });
  it('filters by status', () => {
    addSession(db, { id: 'a', status: 'active' });
    addSession(db, { id: 'f', status: 'finalized' });
    expect(searchSessions(db, { status: 'active' }).map((x) => x.id)).toEqual(['a']);
  });
  it('filters hasConsoleErrors', () => {
    addSession(db, { id: 'err' });
    addSession(db, { id: 'clean' });
    db.prepare(
      "INSERT INTO console_events (session_id, ts_ms, level, message) VALUES ('err', 1, 'error', 'boom')",
    ).run();
    expect(searchSessions(db, { hasConsoleErrors: true }).map((x) => x.id)).toEqual(['err']);
  });
  it('filters hasNetworkErrors (status>=400 or error_text)', () => {
    addSession(db, { id: 'neterr' });
    addSession(db, { id: 'ok' });
    db.prepare(
      "INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES ('neterr', 1, 'GET', 'u', 500)",
    ).run();
    db.prepare(
      "INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES ('ok', 1, 'GET', 'u', 200)",
    ).run();
    expect(searchSessions(db, { hasNetworkErrors: true }).map((x) => x.id)).toEqual(['neterr']);
  });
  it('respects limit and empty = recent (newest first)', () => {
    addSession(db, { id: 'a', updated_at: '2026-01-01T00:00:00Z' });
    addSession(db, { id: 'b', updated_at: '2026-02-01T00:00:00Z' });
    expect(searchSessions(db, {}).map((x) => x.id)).toEqual(['b', 'a']);
    expect(searchSessions(db, { limit: 1 }).map((x) => x.id)).toEqual(['b']);
  });
  it('matches q against url and origin (not just title)', () => {
    addSession(db, { id: 'byurl', title: 'x', url: 'https://a.test/checkout/step' });
    addSession(db, { id: 'byorigin', title: 'y', origin: 'https://checkout.acme.test' });
    addSession(db, { id: 'nomatch', title: 'z', url: 'https://a.test/', origin: 'https://a.test' });
    expect(
      searchSessions(db, { q: 'checkout' })
        .map((x) => x.id)
        .sort(),
    ).toEqual(['byorigin', 'byurl']);
  });
  it('treats _ in q as a literal (escaped), not a single-char wildcard', () => {
    addSession(db, { id: 'lit', title: 'ac_e' });
    addSession(db, { id: 'wild', title: 'acme' });
    expect(searchSessions(db, { q: 'ac_e' }).map((x) => x.id)).toEqual(['lit']);
  });
  it('combines hasConsoleErrors AND hasNetworkErrors as intersection', () => {
    addSession(db, { id: 'consoleOnly' });
    addSession(db, { id: 'networkOnly' });
    addSession(db, { id: 'both' });
    db.prepare(
      "INSERT INTO console_events (session_id, ts_ms, level, message) VALUES ('consoleOnly', 1, 'error', 'x')",
    ).run();
    db.prepare(
      "INSERT INTO console_events (session_id, ts_ms, level, message) VALUES ('both', 1, 'error', 'x')",
    ).run();
    db.prepare(
      "INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES ('networkOnly', 1, 'GET', 'u', 500)",
    ).run();
    db.prepare(
      "INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES ('both', 1, 'GET', 'u', 500)",
    ).run();
    expect(
      searchSessions(db, { hasConsoleErrors: true, hasNetworkErrors: true }).map((x) => x.id),
    ).toEqual(['both']);
  });
});
