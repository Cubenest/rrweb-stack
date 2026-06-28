import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneSessions, sumSessionBytes } from '../src/lib/db.js';

let home: string;
let orig: string | undefined;
let db: Database;
let blobBase: string;

function seed(id: string, bytes: number): void {
  db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'finalized')`,
  ).run(id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'u', 't', 'o', 1, bytes);
  const dir = join(blobBase, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '0.json.gz'), 'x');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-prune-apply-'));
  orig = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
  db = openDb({ path: join(home, 'sessions.db') });
  blobBase = join(home, 'rrweb-events');
});
afterEach(() => {
  db.close();
  if (orig === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = orig;
  rmSync(home, { recursive: true, force: true });
});

describe('sumSessionBytes', () => {
  it('sums the bytes column across sessions (0 when empty)', () => {
    expect(sumSessionBytes(db)).toBe(0);
    seed('a', 100);
    seed('b', 250);
    expect(sumSessionBytes(db)).toBe(350);
  });
});

describe('pruneSessions', () => {
  it('deletes rows + blob dirs, leaves others, returns the count', () => {
    seed('keep', 10);
    seed('gone', 10);
    const n = pruneSessions(db, ['gone'], blobBase);
    expect(n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM sessions WHERE id = ?').get('gone')).toEqual({
      c: 0,
    });
    expect(db.prepare('SELECT COUNT(*) c FROM sessions WHERE id = ?').get('keep')).toEqual({
      c: 1,
    });
    expect(existsSync(join(blobBase, 'gone'))).toBe(false);
    expect(existsSync(join(blobBase, 'keep'))).toBe(true);
  });

  it('preserves the audit_log row (session_id set NULL, not deleted)', () => {
    seed('s', 10);
    // audit_log NOT NULL columns from 0001_initial.sql: ts, tool. All others nullable.
    db.prepare(
      `INSERT INTO audit_log (session_id, ts, tool, client, result)
       VALUES ('s', '2026-01-01T00:00:00.000Z', 'get_page_view', 'test', 'allow')`,
    ).run();
    pruneSessions(db, ['s'], blobBase);
    const row = db.prepare('SELECT session_id FROM audit_log').get() as {
      session_id: string | null;
    };
    expect(row.session_id).toBeNull();
  });

  it('is idempotent when a blob dir is already gone and accepts an empty id list', () => {
    seed('s', 10);
    rmSync(join(blobBase, 's'), { recursive: true, force: true });
    expect(() => pruneSessions(db, ['s'], blobBase)).not.toThrow();
    expect(pruneSessions(db, [], blobBase)).toBe(0);
  });
});
