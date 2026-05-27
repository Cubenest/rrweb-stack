// Locate + load + decompress a session's rrweb event blob (ADR-0007). The
// native host persists each session's captured `eventWithTime[]` gzipped under
// ~/.peek/rrweb-events/, referenced by `sessions.events_blob_path` (a path
// relative to that directory). The event-level MCP tools
// (get_user_action_before_error, get_dom_snapshot, query_dom_history,
// generate_playwright_repro) read the blob through here and walk the decoded
// stream — the console/network tools read the structured SQL tables directly.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { decompress, type eventWithTime } from '@cubenest/rrweb-core';
import { peekHomeDir } from '../db/open.js';

/** Absolute base directory for the gzipped per-session event blobs. */
export function rrwebEventsDir(): string {
  return join(peekHomeDir(), 'rrweb-events');
}

/**
 * Resolve a `sessions.events_blob_path` value to an absolute path. The column
 * stores a path relative to {@link rrwebEventsDir}; an absolute value (older
 * rows / tests) is honored as-is.
 */
export function resolveBlobPath(blobPath: string, baseDir: string = rrwebEventsDir()): string {
  return isAbsolute(blobPath) ? blobPath : join(baseDir, blobPath);
}

/**
 * Read + gunzip + JSON-parse a session's event blob into the rrweb event array.
 * Returns an empty array when the session has no blob path recorded or the
 * blob file is missing (e.g. an active session before its first flush, or a
 * blob pruned by retention) — callers degrade to "no events" rather than throw.
 *
 * @param blobPath the `sessions.events_blob_path` value (relative or absolute)
 * @param baseDir  override the ~/.peek/rrweb-events base (tests)
 */
export function loadSessionEvents(
  blobPath: string | null | undefined,
  baseDir: string = rrwebEventsDir(),
): eventWithTime[] {
  if (blobPath === null || blobPath === undefined || blobPath.length === 0) {
    return [];
  }
  const abs = resolveBlobPath(blobPath, baseDir);
  if (!existsSync(abs)) {
    return [];
  }
  const bytes = readFileSync(abs);
  // readFileSync returns a Node Buffer; decompress wants a Uint8Array view.
  return decompress(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
