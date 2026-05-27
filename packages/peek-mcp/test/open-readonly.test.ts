import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, openReadonlyDb } from '../src/db/open.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-ro-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openReadonlyDb', () => {
  it('reports exists:false when the DB file has never been created', () => {
    const result = openReadonlyDb(join(dir, 'sessions.db'));
    expect(result.exists).toBe(false);
    expect(result.db).toBeUndefined();
  });

  it('opens an existing DB read-only and can SELECT', () => {
    const path = join(dir, 'sessions.db');
    // Simulate the native host having created + migrated the store.
    const writer = openDb({ path });
    writer
      .prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)')
      .run('s_1', '2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z');
    writer.close();

    const result = openReadonlyDb(path);
    expect(result.exists).toBe(true);
    const row = result.db?.prepare('SELECT id FROM sessions WHERE id = ?').get('s_1') as
      | { id: string }
      | undefined;
    expect(row?.id).toBe('s_1');
    result.db?.close();
  });

  it('rejects writes through the read-only handle', () => {
    const path = join(dir, 'sessions.db');
    openDb({ path }).close();

    const result = openReadonlyDb(path);
    expect(result.exists).toBe(true);
    expect(() =>
      result.db
        ?.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)')
        .run('s_x', 'a', 'b'),
    ).toThrow();
    result.db?.close();
  });
});
