// Public DB surface re-exported for the thin clients (@peekdev/cli, and the MCP
// server itself) so they open ~/.peek/sessions.db through the same open/migrate
// path the native host owns — no duplicated DB code (ADR-0007). Consumed as the
// `@peekdev/mcp/db` subpath export.

export {
  defaultDbPath,
  openDb,
  type OpenDbOptions,
  peekHomeDir,
  schemaVersion,
} from './open.js';
export {
  defaultMigrationsDir,
  loadMigrations,
  type Migration,
  runMigrations,
} from './migrate.js';
