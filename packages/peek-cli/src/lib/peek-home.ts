// Resolve the ~/.peek paths the CLI reads (ADR-0007 layout). The DB path +
// home come from @peekdev/mcp/db so the CLI and native host agree on the
// PEEK_HOME override; the audit log path is added here.

import { join } from 'node:path';
import { defaultDbPath, peekHomeDir } from '@peekdev/mcp/db';

export { defaultDbPath, peekHomeDir };

/** Absolute path to the append-only audit log (~/.peek/audit.log, ADR-0010). */
export function auditLogPath(): string {
  return join(peekHomeDir(), 'audit.log');
}

/**
 * Base directory for gzipped rrweb event chunks (ADR-0007): `~/.peek/rrweb-events/`.
 * Each session has a subdirectory `<sessionId>/` with one `<seq>.json.gz` per
 * append batch. Mirrors `rrwebEventsDir()` in peek-mcp's `mcp/event-blobs.ts`;
 * the path layout is the public contract between writer (native host) and
 * reader/cleaner (this CLI).
 */
export function rrwebEventsDir(): string {
  return join(peekHomeDir(), 'rrweb-events');
}
