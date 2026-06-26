import { createHash } from 'node:crypto';

// DUPLICATED from @peekdev/mcp src/native-host/audit-chain.ts on purpose (no cross-package
// import). The pinned known-answer vector test in BOTH packages guards against drift.
export const GENESIS_PREV = 'peek-audit-genesis-v1';
export const LOCK_GAP_PREV = 'peek-audit-lockgap-v1';
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
export function hashLine(line: string): string {
  const body = line.endsWith('\n') ? line.slice(0, -1) : line;
  return sha256Hex(Buffer.from(body, 'utf8'));
}

export interface AuditHead {
  version: number;
  prefix: { bytes: number; sha256: string } | null;
  seq: number;
  headHash: string;
  gapCount: number;
  bytes: number;
  updatedAt?: string;
}

export type VerifyStatus =
  | 'intact'
  | 'broken'
  | 'truncated'
  | 'prefix-tampered'
  | 'incomplete-final'
  | 'gaps'
  | 'head-missing';

export interface VerifyResult {
  status: VerifyStatus;
  entriesVerified: number;
  prelude: number;
  headPresent: boolean;
  brokenAtLine?: number; // 1-based, counted from the start of the file
  expected?: string;
  got?: string;
  gaps?: number[];
}

const NL = 0x0a;

/** Split a buffer into line-buffers (excluding the trailing newline) plus a flag for an unterminated final line. */
function splitLines(
  buf: Buffer,
  fromByte: number,
): { lines: Buffer[]; unterminatedFinal: boolean } {
  const lines: Buffer[] = [];
  let start = fromByte;
  let unterminatedFinal = false;
  for (let i = fromByte; i < buf.length; i++) {
    if (buf[i] === NL) {
      lines.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < buf.length) {
    lines.push(buf.subarray(start));
    unterminatedFinal = true;
  }
  return { lines, unterminatedFinal };
}

export function verifyAuditChain(logBuf: Buffer, head: AuditHead | null): VerifyResult {
  const preludeBytes = head?.prefix?.bytes ?? 0;

  // 1. Prelude seal check.
  let prelude = 0;
  if (head?.prefix) {
    const preludeBuf = logBuf.subarray(0, preludeBytes);
    if (sha256Hex(preludeBuf) !== head.prefix.sha256) {
      return { status: 'prefix-tampered', entriesVerified: 0, prelude: 0, headPresent: true };
    }
    prelude = splitLines(preludeBuf, 0).lines.filter((l) => l.length > 0).length;
  }

  // 2. Walk the chained region.
  const { lines, unterminatedFinal } = splitLines(logBuf, preludeBytes);
  let running = GENESIS_PREV;
  let verified = 0;
  let lastSeq = 0;
  const gaps: number[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    // biome-ignore lint/style/noNonNullAssertion: idx is bounded by lines.length above
    const lineBuf = lines[idx]!;
    if (lineBuf.length === 0) continue;
    const fileLineNo = prelude + idx + 1; // 1-based across the whole file
    const isLast = idx === lines.length - 1;
    let obj: { seq?: number; prevHash?: string };
    try {
      obj = JSON.parse(lineBuf.toString('utf8'));
    } catch {
      if (isLast && unterminatedFinal) {
        return {
          status: 'incomplete-final',
          entriesVerified: verified,
          prelude,
          headPresent: !!head,
        };
      }
      return {
        status: 'broken',
        entriesVerified: verified,
        prelude,
        headPresent: !!head,
        brokenAtLine: fileLineNo,
      };
    }
    if (obj.prevHash === LOCK_GAP_PREV) {
      gaps.push(fileLineNo);
    } else if (obj.prevHash !== running) {
      return {
        status: 'broken',
        entriesVerified: verified,
        prelude,
        headPresent: !!head,
        brokenAtLine: fileLineNo,
        expected: running,
        ...(typeof obj.prevHash === 'string' ? { got: obj.prevHash } : {}),
      };
    }
    running = hashLine(lineBuf.toString('utf8'));
    if (typeof obj.seq === 'number') lastSeq = obj.seq;
    verified++;
  }

  // 3. Compare to head (truncation / completeness).
  // Status precedence (earliest-detected wins): prefix-tampered (step 1) ->
  // broken/incomplete-final (step 2, mid-walk return) -> head-missing ->
  // truncated -> gaps -> intact. A complete-but-newline-terminated chain that
  // simply lacks a head is head-missing; a complete-but-unterminated *final*
  // line is intentionally treated as a normal entry (only an unparseable
  // unterminated tail is incomplete-final).
  if (!head)
    return { status: 'head-missing', entriesVerified: verified, prelude, headPresent: false };
  if (lastSeq < head.seq) {
    return { status: 'truncated', entriesVerified: verified, prelude, headPresent: true };
  }
  if (gaps.length)
    return { status: 'gaps', entriesVerified: verified, prelude, headPresent: true, gaps };
  return { status: 'intact', entriesVerified: verified, prelude, headPresent: true };
}
