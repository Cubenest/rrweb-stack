// Tests for getConsoleErrorById + getNetworkErrorsInWindow (H1.2 causal chain queries).
//
// DB setup replicates ingest.test.ts: openDb({ path: ':memory:' }) runs
// all migrations automatically (same pattern used across the suite).

import type { Database } from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getConsoleErrorById, getNetworkErrorsInWindow } from '../src/mcp/queries.js';

function makeTestDb(): Database.Database {
  return openDb({ path: ':memory:' });
}

describe('getConsoleErrorById', () => {
  it('returns the full console row by id, or undefined when absent', () => {
    const db = makeTestDb();
    db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at) VALUES ('s1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO console_events (id, session_id, ts_ms, level, message, stack) VALUES (7,'s1',5000,'error','Boom','at x')",
    ).run();
    expect(getConsoleErrorById(db, 's1', 7)).toEqual({
      id: 7,
      ts: 5000,
      level: 'error',
      message: 'Boom',
      stack: 'at x',
    });
    expect(getConsoleErrorById(db, 's1', 999)).toBeUndefined();
    db.close();
  });

  it('returns undefined for a non-error console row (level filter)', () => {
    const db = makeTestDb();
    db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at) VALUES ('s1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO console_events (id, session_id, ts_ms, level, message, stack) VALUES (9,'s1',5000,'warn','heads up',null)",
    ).run();
    expect(getConsoleErrorById(db, 's1', 9)).toBeUndefined();
    db.close();
  });
});

describe('getNetworkErrorsInWindow', () => {
  it('returns in-window error-ish network rows ascending by ts', () => {
    const db = makeTestDb();
    db.prepare(
      "INSERT INTO sessions (id, created_at, updated_at) VALUES ('s1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
    ).run();
    const ins = db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status, error_text) VALUES (?,?,?,?,?,?)',
    );
    ins.run('s1', 900, 'GET', '/before', 500, null); // before window
    ins.run('s1', 1200, 'POST', '/api/login', 500, null); // in window, error
    ins.run('s1', 1300, 'GET', '/ok', 200, null); // in window, NOT an error
    ins.run('s1', 1400, 'GET', '/x', null, 'net::ERR'); // in window, transport error
    const rows = getNetworkErrorsInWindow(db, 's1', 1000, 2000);
    expect(rows.map((r) => r.url)).toEqual(['/api/login', '/x']);
    expect(rows[0]).toMatchObject({ method: 'POST', status: 500 });
    db.close();
  });
});
