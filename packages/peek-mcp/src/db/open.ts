// Database open + bootstrap. The native host, MCP server, and CLI all open the
// same ~/.peek/sessions.db through here so the pragmas (WAL, foreign keys) and
// the migration state stay consistent across the three thin clients (ADR-0007).

import { mkdirSync } from 'node:fs';
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
}

/**
 * Open (creating if needed) the peek SQLite database with WAL mode + foreign
 * keys enabled, run any pending migrations, and return the connection. The
 * caller owns closing it.
 */
export function openDb(options: OpenDbOptions = {}): Database.Database {
  const path = options.path ?? defaultDbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  // WAL gives concurrent readers (CLI/MCP) while the host writes (ADR-0007).
  db.pragma('journal_mode = WAL');
  // Enforce the ON DELETE CASCADE / SET NULL foreign keys in the schema.
  db.pragma('foreign_keys = ON');

  if (!options.skipMigrations) {
    runMigrations(db);
  }
  return db;
}

export { schemaVersion };
