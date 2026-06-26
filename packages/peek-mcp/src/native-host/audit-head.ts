import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GENESIS_PREV, LOCK_GAP_PREV, sha256Hex } from './audit-chain.js';

export interface AuditHead {
  version: 1;
  /** Bytes of the pre-chain prelude (legacy unchained lines), sealed by sha256. null if none. */
  prefix: { bytes: number; sha256: string } | null;
  /** seq of the last chained line (0 = no chained lines yet). */
  seq: number;
  /** hashLine() of the last chained line, or GENESIS_PREV when seq === 0. */
  headHash: string;
  /** number of LOCK_GAP_PREV lines written under lock contention. */
  gapCount: number;
  /** total log-file size when this head was written (O(1) drift detection). */
  bytes: number;
  updatedAt?: string;
}

export function auditHeadPath(logPath: string): string {
  return join(dirname(logPath), 'audit.head.json');
}
export function auditLockPath(logPath: string): string {
  return join(dirname(logPath), 'audit.lock');
}

export function readHead(headPath: string): AuditHead | null {
  if (!existsSync(headPath)) return null;
  try {
    return JSON.parse(readFileSync(headPath, 'utf8')) as AuditHead;
  } catch {
    return null; // malformed head → caller will rebuild
  }
}

/** Atomic JSON write: temp in same dir, then rename. Mode 0600 (POSIX). */
export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, path);
}
export function writeHeadAtomic(headPath: string, head: AuditHead): void {
  writeJsonAtomic(headPath, head);
}

/**
 * True iff the log already contains chained entries — i.e. its first non-empty
 * line parses as JSON and carries a string `prevHash` field. Pure legacy
 * (unchained) lines lack `prevHash`, so this distinguishes "head is missing but
 * the chain is real" (rebuild) from "first ever chained write over a legacy
 * log" (seal as prefix). Used by loadHead in audit.ts.
 */
export function logIsChained(logPath: string): boolean {
  if (!existsSync(logPath)) return false;
  const buf = readFileSync(logPath);
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue; // '\n'
    const lineBuf = buf.subarray(start, i);
    start = i + 1;
    if (lineBuf.length === 0) continue;
    return firstLineIsChained(lineBuf);
  }
  // No newline found, or only a trailing unterminated fragment: treat the
  // remainder (if any) as the first line.
  if (start < buf.length) return firstLineIsChained(buf.subarray(start));
  return false;
}

function firstLineIsChained(lineBuf: Buffer): boolean {
  try {
    const obj = JSON.parse(lineBuf.toString('utf8')) as { prevHash?: unknown };
    return typeof obj.prevHash === 'string';
  } catch {
    return false;
  }
}

export function initHead(logPath: string): AuditHead {
  if (!existsSync(logPath)) {
    return { version: 1, prefix: null, seq: 0, headHash: GENESIS_PREV, gapCount: 0, bytes: 0 };
  }
  const buf = readFileSync(logPath);
  if (buf.length === 0) {
    return { version: 1, prefix: null, seq: 0, headHash: GENESIS_PREV, gapCount: 0, bytes: 0 };
  }
  // Seal the existing unchained region by hashing its exact bytes.
  return {
    version: 1,
    prefix: { bytes: buf.length, sha256: sha256Hex(buf) },
    seq: 0,
    headHash: GENESIS_PREV,
    gapCount: 0,
    bytes: buf.length,
  };
}

/**
 * Rebuild the head from the log on disk (used when file-size drift is detected).
 * Walks the chained region after `prefix.bytes`, taking the last well-formed line.
 * Does NOT validate the chain — that is verify's job; this only re-points the head
 * so new appends continue from the actual tail.
 */
export function rebuildHeadFromLog(logPath: string, prefix: AuditHead['prefix']): AuditHead {
  const buf = existsSync(logPath) ? readFileSync(logPath) : Buffer.alloc(0);
  const preludeBytes = prefix?.bytes ?? 0;
  const region = buf.subarray(preludeBytes);
  let seq = 0;
  let headHash = GENESIS_PREV;
  let gapCount = 0;
  let start = 0;
  for (let i = 0; i < region.length; i++) {
    if (region[i] !== 0x0a) continue; // '\n'
    const lineBuf = region.subarray(start, i);
    start = i + 1;
    if (lineBuf.length === 0) continue;
    const text = lineBuf.toString('utf8');
    try {
      const obj = JSON.parse(text) as { seq?: number; prevHash?: string };
      if (typeof obj.seq === 'number') seq = obj.seq;
      if (obj.prevHash === LOCK_GAP_PREV) gapCount++;
      headHash = sha256Hex(lineBuf); // == hashLine(text)
    } catch {
      // malformed/partial line: ignore for head purposes (verify will flag it)
    }
  }
  return { version: 1, prefix, seq, headHash, gapCount, bytes: buf.length };
}
