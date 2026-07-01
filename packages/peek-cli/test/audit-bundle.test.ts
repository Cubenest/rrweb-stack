import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  packAuditBundle,
  unpackAuditBundle,
  verifyAuditBundleIntegrity,
} from '../src/lib/audit-bundle.js';
import { GENESIS_PREV, hashLine } from '../src/lib/audit-chain.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-ab-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeChain(): { logBuf: Buffer; headBuf: Buffer } {
  const l1 = JSON.stringify({ ts: 't1', tool: 'execute_action', seq: 1, prevHash: GENESIS_PREV });
  const h1 = hashLine(l1);
  const l2 = JSON.stringify({ ts: 't2', tool: 'execute_action', seq: 2, prevHash: h1 });
  const logBuf = Buffer.from(`${l1}\n${l2}\n`, 'utf8');
  const head = {
    version: 1,
    prefix: null,
    seq: 2,
    headHash: hashLine(l2),
    gapCount: 0,
    bytes: logBuf.length,
  };
  return { logBuf, headBuf: Buffer.from(JSON.stringify(head), 'utf8') };
}

describe('audit-bundle', () => {
  it('round-trips a bundle with a head and passes integrity', () => {
    const { logBuf, headBuf } = writeChain();
    const out = join(dir, 'evidence.peekaudit');
    packAuditBundle(out, { logBuf, headBuf, head: JSON.parse(headBuf.toString('utf8')) });
    const unpacked = unpackAuditBundle(out);
    expect(unpacked.manifest.kind).toBe('audit');
    expect(unpacked.manifest.headPresent).toBe(true);
    expect(() => verifyAuditBundleIntegrity(unpacked)).not.toThrow();
  });
  it('detects a tampered audit.log (sha mismatch)', () => {
    const { logBuf, headBuf } = writeChain();
    const out = join(dir, 'evidence.peekaudit');
    packAuditBundle(out, { logBuf, headBuf, head: JSON.parse(headBuf.toString('utf8')) });
    const unpacked = unpackAuditBundle(out);
    unpacked.logBuf = Buffer.from(`${unpacked.logBuf.toString('utf8')}tamper\n`, 'utf8');
    expect(() => verifyAuditBundleIntegrity(unpacked)).toThrow(/sha256 mismatch/i);
  });
  it('packs without a head (headPresent:false)', () => {
    const { logBuf } = writeChain();
    const out = join(dir, 'nohead.peekaudit');
    packAuditBundle(out, { logBuf, headBuf: null, head: null });
    const unpacked = unpackAuditBundle(out);
    expect(unpacked.manifest.headPresent).toBe(false);
    expect(unpacked.headBuf).toBeNull();
    expect(() => verifyAuditBundleIntegrity(unpacked)).not.toThrow();
  });
  it('throws on an unsupported formatVersion', () => {
    const { logBuf, headBuf } = writeChain();
    const out = join(dir, 'v.peekaudit');
    packAuditBundle(out, { logBuf, headBuf, head: JSON.parse(headBuf.toString('utf8')) });
    const unpacked = unpackAuditBundle(out);
    unpacked.manifest.formatVersion = 2;
    expect(() => verifyAuditBundleIntegrity(unpacked)).toThrow(/formatVersion/);
  });
  it('detects a tampered audit.head.json (sha mismatch)', () => {
    const { logBuf, headBuf } = writeChain();
    const out = join(dir, 'h.peekaudit');
    packAuditBundle(out, { logBuf, headBuf, head: JSON.parse(headBuf.toString('utf8')) });
    const unpacked = unpackAuditBundle(out);
    unpacked.headBuf = Buffer.from(`${unpacked.headBuf?.toString('utf8') ?? ''}x`, 'utf8');
    expect(() => verifyAuditBundleIntegrity(unpacked)).toThrow(
      /audit\.head\.json sha256 mismatch/i,
    );
  });
  it('throws when the manifest claims a head but the buffer is missing', () => {
    const { logBuf, headBuf } = writeChain();
    const out = join(dir, 'm.peekaudit');
    packAuditBundle(out, { logBuf, headBuf, head: JSON.parse(headBuf.toString('utf8')) });
    const unpacked = unpackAuditBundle(out);
    unpacked.headBuf = null;
    expect(() => verifyAuditBundleIntegrity(unpacked)).toThrow(
      /audit\.head\.json sha256 mismatch/i,
    );
  });
});
