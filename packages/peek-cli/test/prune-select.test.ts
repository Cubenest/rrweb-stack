import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectPruneCandidates } from '../src/lib/db.js';

let home: string;
let orig: string | undefined;
let db: Database;

function seed(id: string, updatedAt: string, bytes: number, status = 'finalized'): void {
  db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, updatedAt, updatedAt, 'https://app.test', 'T', 'https://app.test', 1, bytes, status);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-prune-'));
  orig = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
  db = openDb({ path: join(home, 'sessions.db') });
});
afterEach(() => {
  db.close();
  if (orig === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = orig;
  rmSync(home, { recursive: true, force: true });
});

const NOW = Date.parse('2026-06-28T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('selectPruneCandidates', () => {
  it('empty policy selects nothing', () => {
    seed('a', daysAgo(100), 10);
    expect(selectPruneCandidates(db, {}, NOW)).toEqual([]);
  });

  it('age rule selects only sessions older than maxAge, oldest-first', () => {
    seed('new', daysAgo(1), 10);
    seed('old', daysAgo(40), 10);
    seed('older', daysAgo(90), 10);
    const ids = selectPruneCandidates(db, { maxAge: '30d' }, NOW).map((c) => c.id);
    expect(ids).toEqual(['older', 'old']);
  });

  it('keepLast floor protects the N most-recent even under an aggressive age rule', () => {
    seed('s1', daysAgo(10), 10);
    seed('s2', daysAgo(20), 10);
    seed('s3', daysAgo(30), 10);
    const ids = selectPruneCandidates(db, { maxAge: '1d', keepLast: 2 }, NOW).map((c) => c.id);
    expect(ids).toEqual(['s3']);
  });

  it('disk rule evicts oldest-first until total bytes <= cap', () => {
    seed('newest', daysAgo(1), 100);
    seed('mid', daysAgo(2), 100);
    seed('oldest', daysAgo(3), 100);
    const ids = selectPruneCandidates(db, { maxSizeBytes: 150 }, NOW).map((c) => c.id);
    expect(ids).toEqual(['oldest', 'mid']);
  });

  it('excludes active sessions by default; includes only stale-active past the cutoff with the flag', () => {
    seed('done', daysAgo(40), 10, 'finalized');
    seed('live', daysAgo(40), 10, 'active');
    seed('livefresh', daysAgo(1), 10, 'active');
    expect(selectPruneCandidates(db, { maxAge: '30d' }, NOW).map((c) => c.id)).toEqual(['done']);
    expect(
      selectPruneCandidates(db, { maxAge: '30d' }, NOW, { includeStaleActive: true })
        .map((c) => c.id)
        .sort(),
    ).toEqual(['done', 'live']);
  });

  it('reports disk cap as unmet rather than violating the keepLast floor', () => {
    seed('a', daysAgo(1), 100);
    seed('b', daysAgo(2), 100);
    expect(selectPruneCandidates(db, { maxSizeBytes: 50, keepLast: 2 }, NOW)).toEqual([]);
  });

  it('breaks updated_at ties deterministically by id (stable preview/apply)', () => {
    const ts = daysAgo(40);
    seed('s_aaa', ts, 10);
    seed('s_bbb', ts, 10);
    seed('s_ccc', ts, 10);
    const run = () =>
      selectPruneCandidates(db, { maxAge: '30d', keepLast: 1 }, NOW).map((c) => c.id);
    // ORDER BY updated_at DESC, id DESC → rows [s_ccc, s_bbb, s_aaa]; keepLast:1 protects s_ccc.
    expect(run()).toEqual(['s_aaa', 's_bbb']);
    expect(run()).toEqual(run()); // stable across calls
  });

  it('a session that is both old and over-cap is marked by age (single reason); pure disk eviction is "disk"', () => {
    seed('oldbig', daysAgo(90), 100);
    seed('newbig', daysAgo(1), 100);
    // maxAge prunes oldbig (reason age); maxSize 150 then needs to evict from the remainder.
    const cands = selectPruneCandidates(db, { maxAge: '30d', maxSizeBytes: 150 }, NOW);
    const byId = Object.fromEntries(cands.map((c) => [c.id, c.reasons]));
    expect(byId.oldbig).toEqual(['age']);
    // newbig (100) alone is <=150 after oldbig is age-freed, so it is NOT disk-evicted.
    expect(byId.newbig).toBeUndefined();
  });
});
