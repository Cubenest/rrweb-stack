// `peek audit verify [--dir <path>] [--json]` command (Task 6, ADR-0010).
// Reads audit.log + audit.head.json from the peek home directory (or a
// caller-supplied --dir), runs verifyAuditChain, and emits a human or
// machine-readable result.
//
// Exit codes:
//   0  intact | head-missing | no-log
//   1  anomaly: incomplete-final | gaps
//   2  tampered: broken | truncated | prefix-tampered

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type AuditHead, type VerifyResult, verifyAuditChain } from '../lib/audit-chain.js';
import { peekHomeDir } from '../lib/peek-home.js';

const EXIT = { ok: 0, anomaly: 1, tampered: 2 } as const;

function exitCodeFor(status: VerifyResult['status']): number {
  switch (status) {
    case 'broken':
    case 'truncated':
    case 'prefix-tampered':
      return EXIT.tampered;
    case 'incomplete-final':
    case 'gaps':
      return EXIT.anomaly;
    default:
      return EXIT.ok; // intact, head-missing
  }
}

function human(r: VerifyResult): string {
  const pre = r.prelude ? `prelude of ${r.prelude} entries sealed; ` : '';
  switch (r.status) {
    case 'intact':
      return `${pre}audit chain intact through ${r.entriesVerified} entries.\n`;
    case 'head-missing':
      return `${pre}chain internally consistent through ${r.entriesVerified} entries; head file missing, so tail truncation cannot be ruled out.\n`;
    case 'broken':
      return `${pre}chain broken at line ${r.brokenAtLine}: expected prevHash ${r.expected ?? '?'}, got ${r.got ?? '?'}.\n`;
    case 'truncated':
      return `${pre}tail truncated: log ends before the recorded head (verified ${r.entriesVerified} entries).\n`;
    case 'prefix-tampered':
      return 'pre-chain prelude was modified (sealed hash mismatch).\n';
    case 'incomplete-final':
      return `${pre}incomplete final entry (likely a crash mid-write); chain intact through ${r.entriesVerified} entries.\n`;
    case 'gaps':
      return `${pre}chain intact except ${r.gaps?.length ?? 0} intentional gap(s) (lock contention) at line(s) ${(r.gaps ?? []).join(', ')}.\n`;
  }
}

export async function runAuditVerify(
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      json: { type: 'boolean' },
      dir: { type: 'string' },
    },
    allowPositionals: false,
  });
  const dir = values.dir ?? peekHomeDir();
  const logPath = join(dir, 'audit.log');
  const headPath = join(dir, 'audit.head.json');

  if (!existsSync(logPath)) {
    write(values.json ? '{"status":"no-log"}\n' : 'no audit log found.\n');
    return EXIT.ok;
  }

  const logBuf = readFileSync(logPath);
  let head: AuditHead | null = null;
  if (existsSync(headPath)) {
    try {
      head = JSON.parse(readFileSync(headPath, 'utf8')) as AuditHead;
    } catch {
      head = null; // malformed head → treat as missing (degrades to head-missing, not a crash)
    }
  }

  const result = verifyAuditChain(logBuf, head);
  write(values.json ? `${JSON.stringify(result)}\n` : human(result));
  return exitCodeFor(result.status);
}
