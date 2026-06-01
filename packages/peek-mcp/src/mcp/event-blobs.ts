// Locate + load + decompress a session's rrweb event blob (ADR-0007). The
// native host persists each session's captured `eventWithTime[]` gzipped under
// ~/.peek/rrweb-events/, referenced by `sessions.events_blob_path` (a path
// relative to that directory). The event-level MCP tools
// (get_user_action_before_error, get_dom_snapshot, query_dom_history,
// generate_playwright_repro) read the blob through here and walk the decoded
// stream — the console/network tools read the structured SQL tables directly.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { decompress, type eventWithTime } from '@cubenest/rrweb-core';
import { peekHomeDir } from '../db/open.js';

/**
 * A blob exists on disk but couldn't be decoded — a corrupt/truncated gzip
 * frame or a payload that doesn't deserialize to an event array. Distinct from
 * "no blob" (which is a normal empty result): a present-but-broken blob is a
 * real, attributable failure the tool surfaces clearly rather than silently
 * treating as zero events.
 */
export class SessionEventsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SessionEventsError';
  }
}

/** Absolute base directory for the gzipped per-session event blobs. */
export function rrwebEventsDir(): string {
  return join(peekHomeDir(), 'rrweb-events');
}

/**
 * Resolve a `sessions.events_blob_path` value to an absolute path. The column
 * stores a path relative to {@link rrwebEventsDir}; an absolute value (older
 * rows / tests) is honored as-is.
 *
 * Pre-alpha.10 rows store the path as `rrweb-events/<sessionId>` (a duplicated
 * prefix relative to {@link peekHomeDir} instead of {@link rrwebEventsDir}).
 * Strip that one specific leading segment so the legacy and current layouts
 * resolve to the same on-disk directory.
 */
export function resolveBlobPath(blobPath: string, baseDir: string = rrwebEventsDir()): string {
  if (isAbsolute(blobPath)) return blobPath;
  const trimmed =
    blobPath.startsWith('rrweb-events/') || blobPath.startsWith('rrweb-events\\')
      ? blobPath.slice('rrweb-events/'.length)
      : blobPath;
  return join(baseDir, trimmed);
}

/**
 * Read + gunzip + JSON-parse a session's event blob into the rrweb event array.
 * Returns an empty array when the session has no blob path recorded or the
 * blob file/dir is missing (e.g. an active session before its first flush, or
 * a blob pruned by retention) — callers degrade to "no events" rather than throw.
 *
 * The native host writes one gzipped chunk per `session.append` batch at
 * `<events-dir>/<sessionId>/<seq>.json.gz`, and stores `<events-dir>/<sessionId>`
 * (a directory) in `sessions.events_blob_path`. Older rows / tests may instead
 * point at a single `.gz` file — both layouts are honored here.
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
  const stats = statSync(abs);
  if (stats.isDirectory()) {
    return loadChunkedDir(abs, blobPath);
  }
  return decodeOne(abs, blobPath);
}

/**
 * Decode a single gzipped chunk file into its event array. Shared by both the
 * legacy single-file blob layout and the per-chunk reads from {@link loadChunkedDir}.
 */
function decodeOne(absPath: string, displayPath: string): eventWithTime[] {
  const bytes = readFileSync(absPath);
  try {
    // readFileSync returns a Node Buffer; decompress wants a Uint8Array view.
    // decompress throws (fflate gzip error / non-array payload) on a corrupt or
    // truncated blob — translate that into a clear, attributable error.
    return decompress(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (err) {
    throw new SessionEventsError(
      `Failed to decode the event blob at '${displayPath}' (corrupt or truncated recording).`,
      { cause: err },
    );
  }
}

/**
 * Walk `<dir>/<seq>.json.gz` chunk files in numeric seq order, decode each, and
 * concatenate their event arrays. An empty directory (no chunks flushed yet) is
 * a normal empty result, not an error.
 */
function loadChunkedDir(absDir: string, displayPath: string): eventWithTime[] {
  const entries = readdirSync(absDir);
  const seqs: Array<{ seq: number; file: string }> = [];
  for (const name of entries) {
    const match = name.match(/^(\d+)\.json\.gz$/);
    if (match?.[1] === undefined) continue;
    seqs.push({ seq: Number(match[1]), file: name });
  }
  seqs.sort((a, b) => a.seq - b.seq);
  const events: eventWithTime[] = [];
  for (const { file } of seqs) {
    const chunk = decodeOne(join(absDir, file), `${displayPath}/${file}`);
    for (const e of chunk) events.push(e);
  }
  return events;
}
