// Migrations runner (ADR-0007 action item 5): a directory of `NNNN-description.sql`
// files applied in lexical order on host startup, each inside a transaction,
// tracked in a `_migrations` bookkeeping table so re-running is idempotent.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';

/** A single migration discovered on disk. */
export interface Migration {
  /** Numeric prefix, e.g. 1 for `0001_initial.sql`. Determines apply order. */
  readonly version: number;
  /** Full filename, e.g. `0001_initial.sql`. Recorded in `_migrations`. */
  readonly name: string;
  /** Raw SQL contents. */
  readonly sql: string;
}

const MIGRATION_FILE_RE = /^(\d+)[_-].+\.sql$/;

/**
 * Default directory holding the `.sql` migration files, resolved relative to
 * this module. Works from both `src/` (vitest, ts) and `dist/` (built, js)
 * because the build step copies the `migrations/` folder next to the output.
 */
export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

/**
 * Read and parse every `NNNN-*.sql` (or `NNNN_*.sql`) file in `dir`, sorted by
 * numeric version ascending. Non-matching files are ignored.
 */
export function loadMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  const entries = readdirSync(dir);
  const migrations: Migration[] = [];
  for (const name of entries) {
    const match = MIGRATION_FILE_RE.exec(name);
    if (!match) continue;
    migrations.push({
      version: Number(match[1]),
      name,
      sql: readFileSync(join(dir, name), 'utf8'),
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

function ensureMigrationsTable(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
}

function appliedVersions(db: Database): Set<number> {
  const rows = db.prepare('SELECT version FROM _migrations').all() as Array<{
    version: number;
  }>;
  return new Set(rows.map((r) => r.version));
}

/**
 * Apply every pending migration to `db` in order. Each migration runs inside a
 * transaction together with the `_migrations` bookkeeping insert, so a failure
 * mid-migration rolls back cleanly and leaves the version unrecorded.
 *
 * Returns the list of migrations applied during this call (empty if the DB was
 * already up to date).
 */
export function runMigrations(
  db: Database,
  migrations: Migration[] = loadMigrations(),
): Migration[] {
  ensureMigrationsTable(db);
  const already = appliedVersions(db);
  const record = db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const applied: Migration[] = [];

  for (const migration of migrations) {
    if (already.has(migration.version)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
    applied.push(migration);
  }

  return applied;
}

/** Current schema version (highest applied migration), or 0 if none. */
export function schemaVersion(db: Database): number {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as {
    v: number | null;
  };
  return row.v ?? 0;
}
