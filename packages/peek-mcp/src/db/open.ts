// Database open + bootstrap. The native host, MCP server, and CLI all open the
// same ~/.peek/sessions.db through here so the pragmas (WAL, foreign keys) and
// the migration state stay consistent across the three thin clients (ADR-0007).

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations, schemaVersion } from './migrate.js';

/**
 * The native host's data directory (ADR-0007). Defaults to `~/.peek`; the
 * `PEEK_HOME` environment variable overrides it (used by tests and by users who
 * relocate the store).
 */
export function peekHomeDir(): string {
  const override = process.env.PEEK_HOME;
  if (override && override.length > 0) return override;
  return join(homedir(), '.peek');
}

/** Absolute path to the SQLite database file. */
export function defaultDbPath(): string {
  return join(peekHomeDir(), 'sessions.db');
}

export interface OpenDbOptions {
  /**
   * Path to the database file. Defaults to `~/.peek/sessions.db`. Pass
   * `':memory:'` for tests.
   */
  readonly path?: string;
  /** Skip applying migrations on open (default: false). */
  readonly skipMigrations?: boolean;
  /**
   * Open the file read-only (better-sqlite3 `{ readonly: true }`). Forces
   * `skipMigrations` — a read-only handle cannot run DDL, and a read-only
   * client (the MCP server, ADR-0011) must never mutate the host-owned schema.
   * Opening a non-existent file read-only would throw, so the caller is
   * expected to have ensured the file exists (see {@link openReadonlyDb}).
   */
  readonly readonly?: boolean;
}

/**
 * Open (creating if needed) the peek SQLite database with WAL mode + foreign
 * keys enabled, run any pending migrations, and return the connection. The
 * caller owns closing it.
 *
 * When `readonly` is set the handle is opened read-only and migrations are
 * skipped regardless of `skipMigrations`.
 */
export function openDb(options: OpenDbOptions = {}): Database.Database {
  const path = options.path ?? defaultDbPath();
  const readonly = options.readonly ?? false;
  // A read-only open must not create the directory or the file — that would
  // resurrect a deleted store or mask a "never recorded" state as an empty DB.
  if (path !== ':memory:' && !readonly) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, readonly ? { readonly: true } : {});
  if (readonly) {
    // Read-only handles can't enable WAL (a DDL/pragma write); the writer (the
    // native host) already put the file in WAL mode. FK enforcement is moot
    // for a reader. Leave pragmas to the writer.
  } else {
    // WAL gives concurrent readers (CLI/MCP) while the host writes (ADR-0007).
    db.pragma('journal_mode = WAL');
    // Enforce the ON DELETE CASCADE / SET NULL foreign keys in the schema.
    db.pragma('foreign_keys = ON');
  }

  // Read-only handles can't run DDL, so migrations are always skipped there.
  if (!options.skipMigrations && !readonly) {
    runMigrations(db);
  }
  return db;
}

/**
 * The result of {@link openReadonlyDb}: either a live read-only connection, or
 * a sentinel that no store exists yet (no native host has ever run). MCP tools
 * branch on `exists` to return "no sessions recorded yet" rather than throwing.
 */
export type ReadonlyDbResult =
  | { readonly exists: true; readonly db: Database.Database }
  | { readonly exists: false; readonly db: undefined };

/**
 * Open `~/.peek/sessions.db` read-only for a thin client (the MCP server). If
 * the file does not exist — the user installed the MCP server but never ran the
 * extension / native host — return `{ exists: false }` so callers degrade
 * gracefully instead of better-sqlite3 throwing `SQLITE_CANTOPEN`.
 */
export function openReadonlyDb(path: string = defaultDbPath()): ReadonlyDbResult {
  // `:memory:` is only meaningful for tests that seed a writable handle; a
  // read-only in-memory DB is empty and useless, so treat it as "exists" and
  // let the caller manage it.
  if (path !== ':memory:' && !existsSync(path)) {
    return { exists: false, db: undefined };
  }
  return { exists: true, db: openDb({ path, readonly: true }) };
}

export { schemaVersion };
