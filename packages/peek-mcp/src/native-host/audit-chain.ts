import { createHash } from 'node:crypto';
import type { AuditHead } from './audit-head.js';

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

export type VerifyStatus =
  | 'intact'
  | 'broken'
  | 'truncated'
  | 'tail-tampered'
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
  // `seenHashes` accumulates every committed line's hash (seeded with
  // GENESIS_PREV) so step 3 can anchor the sealed head.headHash by MEMBERSHIP
  // rather than naive tail equality — see the tail-tampered rationale below.
  const { lines, unterminatedFinal } = splitLines(logBuf, preludeBytes);
  let running = GENESIS_PREV;
  let verified = 0;
  let lastSeq = 0;
  const gaps: number[] = [];
  const seenHashes = new Set<string>([GENESIS_PREV]);
  let sawIncompleteFinal = false;
  for (let idx = 0; idx < lines.length; idx++) {
    // biome-ignore lint/style/noNonNullAssertion: idx is bounded by lines.length above
    const lineBuf = lines[idx]!;
    if (lineBuf.length === 0) continue;
    const fileLineNo = prelude + idx + 1; // 1-based across the whole file
    // An unterminated final fragment is NOT a committed entry: a crash between
    // the writer's append and its head-write can leave a partial tail line. We
    // do not parse it, do not advance `running`, and do not count it — we just
    // flag it and let the decision ladder downgrade to incomplete-final. This
    // also keeps verify consistent with rebuildHeadFromLog, which ignores
    // unterminated tails (it only advances on newline-terminated lines).
    if (idx === lines.length - 1 && unterminatedFinal) {
      sawIncompleteFinal = true;
      continue;
    }
    let obj: { seq?: number; prevHash?: string };
    try {
      obj = JSON.parse(lineBuf.toString('utf8'));
    } catch {
      // A parse failure on a *terminated* line is genuine corruption — an
      // unterminated tail can never reach this point (skipped above).
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
    seenHashes.add(running);
    if (typeof obj.seq === 'number') lastSeq = obj.seq;
    verified++;
  }

  // 3. Compare to head (truncation / completeness / tail-tamper).
  // Status precedence (earliest-detected wins): prefix-tampered (step 1) ->
  // broken (step 2, mid-walk return) -> head-missing -> truncated ->
  // tail-tampered -> incomplete-final -> gaps -> intact.
  //
  // Tail anchor (the security-critical check): the sealed head.headHash must
  // still appear SOMEWHERE in the walked chain. If it equals the final
  // `running`, the tail is intact. If it appears at an EARLIER line, the head
  // merely lagged the log by one or more entries (a benign crash between the
  // writer's append and its head-write) and the extra lines are validly-chained
  // continuations — not tampering. If it appears NOWHERE, the sealed tail entry
  // was altered (its body changed, so its hash changed) → tampered. A plain
  // tail equality check would false-flag the benign head-lag case, so we use
  // set membership instead.
  if (!head)
    return { status: 'head-missing', entriesVerified: verified, prelude, headPresent: false };
  if (lastSeq < head.seq) {
    return { status: 'truncated', entriesVerified: verified, prelude, headPresent: true };
  }
  if (head.headHash !== GENESIS_PREV && !seenHashes.has(head.headHash)) {
    return {
      status: 'tail-tampered',
      entriesVerified: verified,
      prelude,
      headPresent: true,
      expected: head.headHash,
      got: running,
    };
  }
  if (sawIncompleteFinal) {
    return { status: 'incomplete-final', entriesVerified: verified, prelude, headPresent: true };
  }
  if (gaps.length)
    return { status: 'gaps', entriesVerified: verified, prelude, headPresent: true, gaps };
  return { status: 'intact', entriesVerified: verified, prelude, headPresent: true };
}

/** One-line human summary of a verify result (for the MCP tool's `summary`). */
export function verifySummary(r: VerifyResult): string {
  const pre = r.prelude ? `prelude of ${r.prelude} entries sealed; ` : '';
  switch (r.status) {
    case 'intact':
      return `${pre}audit chain intact through ${r.entriesVerified} entries.`;
    case 'head-missing':
      return `${pre}chain internally consistent through ${r.entriesVerified} entries; head file missing, so tail truncation cannot be ruled out.`;
    case 'broken':
      return `${pre}chain broken at line ${r.brokenAtLine}: expected prevHash ${r.expected ?? '?'}, got ${r.got ?? '?'}.`;
    case 'truncated':
      return `${pre}tail truncated: log ends before the recorded head (verified ${r.entriesVerified} entries).`;
    case 'tail-tampered':
      return `${pre}the sealed tail entry was modified (computed tail hash ${r.got ?? '?'} != sealed head hash ${r.expected ?? '?'}).`;
    case 'prefix-tampered':
      return 'pre-chain prelude was modified (sealed hash mismatch).';
    case 'incomplete-final':
      return `${pre}incomplete final entry (likely a crash mid-write); chain intact through ${r.entriesVerified} entries.`;
    case 'gaps':
      return `${pre}chain intact except ${r.gaps?.length ?? 0} intentional gap(s) (lock contention) at line(s) ${(r.gaps ?? []).join(', ')}.`;
  }
}
