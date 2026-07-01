// Portable audit-evidence archive (*.peekaudit): a gzipped tar of audit.log +
// (optional) audit.head.json + an audit-manifest.json SHA-256 integrity manifest.
// Distinct from *.peekbundle (sessions). Integrity is corruption/tamper detection
// only — no signature (no keys) and no external timestamp anchor.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, extract } from 'tar';
import type { AuditHead } from './audit-chain.js';
import { sha256Hex } from './audit-chain.js';

export const AUDIT_BUNDLE_FORMAT_VERSION = 1;

export const AUDIT_CAVEAT =
  "This archive contains peek's action audit log: the verbs, selectors, prompts, " +
  'and timestamps of browser actions peek authorized or attempted. It does NOT ' +
  'contain page content, field values, or rrweb recordings. Integrity is a ' +
  'SHA-256 manifest (corruption/tamper detection); there is no signature and no ' +
  'external timestamp, so it does not prove who created it or when.';

const ATTRIBUTION =
  'Exported by peek (https://peek.cubenest.in) — local-first browser-session forensics.';

export interface AuditBundleManifest {
  formatVersion: number;
  tool: 'peek';
  kind: 'audit';
  exportedAt: string;
  sha256: { 'audit.log': string; 'audit.head.json'?: string };
  chainHead: { seq: number; headHash: string; gapCount: number } | null;
  headPresent: boolean;
  caveat: string;
  _attribution: string;
}

export interface UnpackedAuditBundle {
  manifest: AuditBundleManifest;
  logBuf: Buffer;
  headBuf: Buffer | null;
}

export interface PackAuditInput {
  logBuf: Buffer;
  headBuf: Buffer | null;
  head: AuditHead | null;
}

export function packAuditBundle(outPath: string, input: PackAuditInput): void {
  const headPresent = input.headBuf !== null && input.head !== null;
  const sha256: AuditBundleManifest['sha256'] = { 'audit.log': sha256Hex(input.logBuf) };
  if (headPresent && input.headBuf) {
    sha256['audit.head.json'] = sha256Hex(input.headBuf);
  }
  const manifest: AuditBundleManifest = {
    formatVersion: AUDIT_BUNDLE_FORMAT_VERSION,
    tool: 'peek',
    kind: 'audit',
    exportedAt: new Date().toISOString(),
    sha256,
    chainHead:
      headPresent && input.head
        ? { seq: input.head.seq, headHash: input.head.headHash, gapCount: input.head.gapCount }
        : null,
    headPresent,
    caveat: AUDIT_CAVEAT,
    _attribution: ATTRIBUTION,
  };
  const members = ['audit-manifest.json', 'audit.log'];
  const tmp = mkdtempSync(join(tmpdir(), 'peek-audit-pack-'));
  try {
    writeFileSync(join(tmp, 'audit-manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(tmp, 'audit.log'), input.logBuf);
    if (headPresent && input.headBuf) {
      writeFileSync(join(tmp, 'audit.head.json'), input.headBuf);
      members.push('audit.head.json');
    }
    create({ gzip: true, file: outPath, cwd: tmp, sync: true }, members);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function unpackAuditBundle(bundlePath: string): UnpackedAuditBundle {
  const tmp = mkdtempSync(join(tmpdir(), 'peek-audit-unpack-'));
  try {
    extract({ file: bundlePath, cwd: tmp, sync: true });
    const manifest = JSON.parse(
      readFileSync(join(tmp, 'audit-manifest.json'), 'utf8'),
    ) as AuditBundleManifest;
    const logBuf = readFileSync(join(tmp, 'audit.log'));
    const headBuf = manifest.headPresent ? readFileSync(join(tmp, 'audit.head.json')) : null;
    return { manifest, logBuf, headBuf };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function verifyAuditBundleIntegrity(b: UnpackedAuditBundle): void {
  if (b.manifest.formatVersion !== AUDIT_BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `unsupported audit bundle formatVersion ${b.manifest.formatVersion} (this peek supports ${AUDIT_BUNDLE_FORMAT_VERSION})`,
    );
  }
  if (sha256Hex(b.logBuf) !== b.manifest.sha256['audit.log']) {
    throw new Error('audit bundle integrity check failed: audit.log sha256 mismatch');
  }
  if (b.manifest.headPresent) {
    if (!b.headBuf || sha256Hex(b.headBuf) !== b.manifest.sha256['audit.head.json']) {
      throw new Error('audit bundle integrity check failed: audit.head.json sha256 mismatch');
    }
  }
}
