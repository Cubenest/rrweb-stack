// `peek audit bundle [--dir <path>] [--out <file>]` — package the audit log +
// head into a portable *.peekaudit evidence archive (SHA-256 integrity manifest).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AUDIT_CAVEAT, packAuditBundle } from '../lib/audit-bundle.js';
import type { AuditHead } from '../lib/audit-chain.js';
import { peekHomeDir } from '../lib/peek-home.js';

const BUNDLE_USAGE = [
  'Usage: peek audit bundle [options]',
  '',
  'Package the audit log + head into a portable *.peekaudit evidence archive.',
  '',
  '  --dir <path>   Directory containing audit.log + audit.head.json (default: ~/.peek)',
  '  --out <file>   Output path (default: ./peek-audit-<date>.peekaudit)',
  '  --help         Show this help and exit',
  '',
].join('\n');

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runAuditBundle(
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    write(BUNDLE_USAGE);
    return 0;
  }
  const dir = values.dir ?? peekHomeDir();
  const logPath = join(dir, 'audit.log');
  if (!existsSync(logPath)) {
    write(`No audit log at ${logPath} — nothing to bundle.\n`);
    return 1;
  }
  const logBuf = readFileSync(logPath);
  const headPath = join(dir, 'audit.head.json');
  let headBuf: Buffer | null = null;
  let head: AuditHead | null = null;
  if (existsSync(headPath)) {
    headBuf = readFileSync(headPath);
    try {
      head = JSON.parse(headBuf.toString('utf8')) as AuditHead;
    } catch {
      headBuf = null; // malformed head → bundle without it
    }
  }
  const out = values.out ?? `peek-audit-${today()}.peekaudit`;
  packAuditBundle(out, { logBuf, headBuf, head });
  write(`${AUDIT_CAVEAT}\n\n`);
  write(`Wrote ${out}`);
  write(head ? ` (chain head seq=${head.seq}).\n` : ' (no head — tail truncation not provable).\n');
  write('Verify a received archive with: peek audit verify --bundle <file>\n');
  return 0;
}
