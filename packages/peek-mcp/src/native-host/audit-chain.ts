import { createHash } from 'node:crypto';

/** prevHash of the first chained line. Stable; changing it breaks all existing chains. */
export const GENESIS_PREV = 'peek-audit-genesis-v1';
/** prevHash sentinel for a line written when the lock could not be acquired (chain gap). */
export const LOCK_GAP_PREV = 'peek-audit-lockgap-v1';

/** Lowercase hex SHA-256 of raw bytes (no newline handling). */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Hash of a single log line: the line's bytes with at most one trailing '\n' removed. */
export function hashLine(line: string): string {
  const body = line.endsWith('\n') ? line.slice(0, -1) : line;
  return sha256Hex(Buffer.from(body, 'utf8'));
}
