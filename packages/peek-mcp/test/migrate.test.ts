import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultMigrationsDir,
  loadMigrations,
  runMigrations,
  schemaVersion,
} from '../src/db/migrate.js';
import { defaultDbPath, openDb, peekHomeDir } from '../src/db/open.js';

const EXPECTED_TABLES = [
  'sessions',
  'events_chunks',
  'console_events',
  'network_events',
  'audit_log',
];

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe('migrations runner', () => {
  it('discovers the 0001_initial migration on disk', () => {
    const migrations = loadMigrations(defaultMigrationsDir());
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]?.version).toBe(1);
    expect(migrations[0]?.name).toBe('0001_initial.sql');
  });

  it('parses migrations sorted by numeric version ascending', () => {
    const migrations = loadMigrations(defaultMigrationsDir());
    const versions = migrations.map((m) => m.version);
    const sorted = [...versions].sort((a, b) => a - b);
    expect(versions).toEqual(sorted);
  });

  it('applies 0001 and creates all five tables', () => {
    const db = new Database(':memory:');
    const applied = runMigrations(db);
    expect(applied.map((m) => m.name)).toContain('0001_initial.sql');

    const names = tableNames(db);
    for (const t of EXPECTED_TABLES) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it('records the schema version after applying', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    // Bumps with every new migration on disk; latest is 0002_network_bodies.
    expect(schemaVersion(db)).toBe(2);
    db.close();
  });

  it('is idempotent — a second run applies nothing', () => {
    const db = new Database(':memory:');
    const first = runMigrations(db);
    expect(first.length).toBeGreaterThanOrEqual(1);
    const second = runMigrations(db);
    expect(second).toHaveLength(0);
    expect(schemaVersion(db)).toBe(2);
    db.close();
  });

  it('enforces the sessions foreign key with cascade delete', () => {
    const db = openDb({ path: ':memory:' });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)').run(
      's_test',
      now,
      now,
    );
    db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message) VALUES (?, ?, ?, ?)',
    ).run('s_test', Date.now(), 'error', 'boom');

    expect((db.prepare('SELECT COUNT(*) AS c FROM console_events').get() as { c: number }).c).toBe(
      1,
    );

    db.prepare('DELETE FROM sessions WHERE id = ?').run('s_test');
    // ON DELETE CASCADE should have removed the child row (foreign_keys = ON).
    expect((db.prepare('SELECT COUNT(*) AS c FROM console_events').get() as { c: number }).c).toBe(
      0,
    );
    db.close();
  });

  it('rejects a foreign key insert with no parent session', () => {
    const db = openDb({ path: ':memory:' });
    expect(() =>
      db
        .prepare('INSERT INTO network_events (session_id, ts_ms, method, url) VALUES (?, ?, ?, ?)')
        .run('s_missing', Date.now(), 'GET', 'https://example.com'),
    ).toThrow(/FOREIGN KEY/i);
    db.close();
  });
});

describe('openDb', () => {
  it('opens an in-memory DB with migrations applied and foreign keys on', () => {
    // Note: WAL is asserted separately on a temp-file DB — an in-memory DB
    // cannot use WAL (journal_mode silently stays `memory`).
    const db = openDb({ path: ':memory:' });
    expect(schemaVersion(db)).toBe(2);
    expect(tableNames(db)).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    expect(db.pragma('foreign_keys', { simple: true }) as number).toBe(1);
    db.close();
  });

  it('opens a file-backed DB in WAL journal mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'peek-wal-'));
    const dbPath = join(dir, 'sessions.db');
    const db = openDb({ path: dbPath });
    try {
      expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
      expect(schemaVersion(db)).toBe(2);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('schemaVersion read-only contract', () => {
  it('returns 0 and does NOT create _migrations on an uninitialized DB', () => {
    const db = new Database(':memory:');
    expect(schemaVersion(db)).toBe(0);
    // The bookkeeping table must not have been created as a side effect.
    const created = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
      .get();
    expect(created).toBeUndefined();
    db.close();
  });
});

describe('peekHomeDir / defaultDbPath', () => {
  const saved = process.env.PEEK_HOME;
  afterEach(() => {
    if (saved === undefined) process.env.PEEK_HOME = '';
    else process.env.PEEK_HOME = saved;
  });

  it('honors the PEEK_HOME override', () => {
    process.env.PEEK_HOME = '/tmp/peek-test-home';
    expect(peekHomeDir()).toBe('/tmp/peek-test-home');
    expect(defaultDbPath()).toBe('/tmp/peek-test-home/sessions.db');
  });

  it('defaults to ~/.peek when PEEK_HOME is unset', () => {
    process.env.PEEK_HOME = '';
    expect(peekHomeDir().endsWith('/.peek')).toBe(true);
  });
});
