import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAuditVerify } from '../src/commands/audit-verify.js';
import {
  type AuditHead,
  GENESIS_PREV,
  hashLine,
  sha256Hex,
  verifyAuditChain,
} from '../src/lib/audit-chain.js';

// Cross-package drift guard: this pinned digest MUST equal the one in
// peek-mcp/test/audit-chain.test.ts. If the primitives drift, this fails.
it('primitives match the writer (pinned known-answer vector)', () => {
  const EXPECTED = '546b9e19e7352f1eb907a1c9aa55d945f9e4664238b432c91a297e52e4da0521';
  expect(GENESIS_PREV).toBe('peek-audit-genesis-v1');
  expect(hashLine('{"seq":1,"prevHash":"peek-audit-genesis-v1"}')).toBe(EXPECTED);
  expect(sha256Hex(Buffer.from('{"seq":1,"prevHash":"peek-audit-genesis-v1"}', 'utf8'))).toBe(
    EXPECTED,
  );
});

function chainLog(n: number): { buf: Buffer; head: AuditHead } {
  let prev = GENESIS_PREV;
  let lastHash = GENESIS_PREV;
  const lines: string[] = [];
  for (let seq = 1; seq <= n; seq++) {
    const line = JSON.stringify({ ts: `t${seq}`, tool: 'execute_action', seq, prevHash: prev });
    lines.push(line);
    lastHash = hashLine(line);
    prev = lastHash;
  }
  const buf = Buffer.from(lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  return {
    buf,
    head: { version: 1, prefix: null, seq: n, headHash: lastHash, gapCount: 0, bytes: buf.length },
  };
}

describe('verifyAuditChain', () => {
  it('reports intact for a well-formed chain', () => {
    const { buf, head } = chainLog(3);
    const r = verifyAuditChain(buf, head);
    expect(r.status).toBe('intact');
    expect(r.entriesVerified).toBe(3);
  });

  it('reports broken at the edited line', () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n');
    // biome-ignore lint/style/noNonNullAssertion: lines[1] is the second of 3+1 (empty trailing) split results
    const obj = JSON.parse(lines[1]!);
    obj.tool = 'tampered';
    lines[1] = JSON.stringify(obj);
    const r = verifyAuditChain(Buffer.from(lines.join('\n'), 'utf8'), head);
    expect(r.status).toBe('broken');
    expect(r.brokenAtLine).toBe(3); // line 3's prevHash no longer matches the edited line 2
  });

  it('reports tail truncation when the file is shorter than the head', () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const truncated = Buffer.from(`${lines.slice(0, 2).join('\n')}\n`, 'utf8');
    const r = verifyAuditChain(truncated, head);
    expect(r.status).toBe('truncated');
  });

  it('reports prefix-tampered when the sealed prelude changed', () => {
    const prelude = '{"ts":"old","tool":"x"}\n';
    const head = {
      version: 1,
      prefix: { bytes: Buffer.byteLength(prelude), sha256: sha256Hex(Buffer.from('DIFFERENT')) },
      seq: 0,
      headHash: GENESIS_PREV,
      gapCount: 0,
      bytes: Buffer.byteLength(prelude),
    };
    const r = verifyAuditChain(Buffer.from(prelude, 'utf8'), head);
    expect(r.status).toBe('prefix-tampered');
  });

  it('reports head-missing (chain checked, truncation unprovable)', () => {
    const { buf } = chainLog(2);
    const r = verifyAuditChain(buf, null);
    expect(r.status).toBe('head-missing');
    expect(r.entriesVerified).toBe(2);
  });

  it('reports incomplete-final for a partial unterminated last line (crash mid-write)', () => {
    const { buf, head } = chainLog(2);
    // append a partial JSON fragment with no closing brace and no trailing newline
    const partial = Buffer.concat([buf, Buffer.from('{"ts":"t3","seq":3,"prevHash"', 'utf8')]);
    const r = verifyAuditChain(partial, head);
    expect(r.status).toBe('incomplete-final');
    expect(r.entriesVerified).toBe(2);
  });

  it('reports tail-tampered when the final entry is edited but seq/prevHash kept', () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // Edit the LAST line's body, keeping its seq + prevHash so the chain still
    // links — only the sealed head.headHash can detect this.
    // biome-ignore lint/style/noNonNullAssertion: lines has 3 entries (filtered)
    const obj = JSON.parse(lines[2]!);
    obj.tool = 'tampered';
    lines[2] = JSON.stringify(obj);
    const tampered = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
    const r = verifyAuditChain(tampered, head);
    expect(r.status).toBe('tail-tampered');
    expect(r.expected).toBe(head.headHash);
  });

  it('reports intact when the head benignly lags by one entry (crash before head-write)', () => {
    const { buf } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // The writer appended line 3 but crashed before advancing the head, so the
    // head still points at line 2. This is benign — head.headHash is in the
    // walked chain (at line 2) and lastSeq (3) ≥ head.seq (2).
    // biome-ignore lint/style/noNonNullAssertion: lines has 3 entries (filtered)
    const line2Raw = `${lines[1]!}\n`;
    const laggingHead: AuditHead = {
      version: 1,
      prefix: null,
      seq: 2,
      headHash: hashLine(line2Raw),
      gapCount: 0,
      bytes: buf.length,
    };
    const r = verifyAuditChain(buf, laggingHead);
    expect(r.status).toBe('intact');
    expect(r.entriesVerified).toBe(3);
  });

  it('reports incomplete-final for a parseable unterminated last line (not counted)', () => {
    const { buf, head } = chainLog(2);
    // A complete, parseable JSON object but with NO trailing newline — a crash
    // after JSON.stringify but before the newline flush. New contract: an
    // unterminated final fragment is never a committed entry.
    const partial = Buffer.concat([
      buf,
      Buffer.from(JSON.stringify({ ts: 't3', tool: 'execute_action', seq: 3 }), 'utf8'),
    ]);
    const r = verifyAuditChain(partial, head);
    expect(r.status).toBe('incomplete-final');
    expect(r.entriesVerified).toBe(2);
  });

  it('reports gaps for lock-gap lines', () => {
    const l1 = JSON.stringify({ ts: 't1', seq: 1, prevHash: GENESIS_PREV });
    const l2 = JSON.stringify({ ts: 't2', seq: 2, prevHash: 'peek-audit-lockgap-v1' });
    const buf = Buffer.from(`${l1}\n${l2}\n`, 'utf8');
    const head = {
      version: 1,
      prefix: null,
      seq: 2,
      headHash: hashLine(l2),
      gapCount: 1,
      bytes: buf.length,
    };
    const r = verifyAuditChain(buf, head);
    expect(r.status).toBe('gaps');
    expect(r.gaps).toEqual([2]);
  });
});

describe('peek audit verify (command)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peek-verify-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('exits 0 and prints "intact" for a good chain', async () => {
    const { buf, head } = chainLog(2);
    writeFileSync(join(dir, 'audit.log'), buf);
    writeFileSync(join(dir, 'audit.head.json'), JSON.stringify(head));
    const out: string[] = [];
    const code = await runAuditVerify(['--dir', dir], (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/intact through 2 entries/i);
  });

  it('exits 2 and pinpoints the broken line', async () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n');
    // biome-ignore lint/style/noNonNullAssertion: lines[1] is the second of 3+1 (empty trailing) split results
    const o = JSON.parse(lines[1]!);
    o.tool = 'x';
    lines[1] = JSON.stringify(o);
    writeFileSync(join(dir, 'audit.log'), lines.join('\n'));
    writeFileSync(join(dir, 'audit.head.json'), JSON.stringify(head));
    const code = await runAuditVerify(['--dir', dir], () => {});
    expect(code).toBe(2);
  });

  it('--json emits machine output', async () => {
    const { buf, head } = chainLog(1);
    writeFileSync(join(dir, 'audit.log'), buf);
    writeFileSync(join(dir, 'audit.head.json'), JSON.stringify(head));
    const out: string[] = [];
    const code = await runAuditVerify(['--dir', dir, '--json'], (s) => out.push(s));
    expect(code).toBe(0);
    expect(JSON.parse(out.join('')).status).toBe('intact');
  });

  it('exits 0 with "no audit log" when the log is absent', async () => {
    const code = await runAuditVerify(['--dir', dir], () => {});
    expect(code).toBe(0);
  });

  it('prints usage and exits 0 for --help without touching any files', async () => {
    const out: string[] = [];
    // No audit.log / audit.head.json exist in `dir`, so this also proves --help
    // short-circuits BEFORE any file read.
    const code = await runAuditVerify(['--help'], (s) => out.push(s));
    expect(code).toBe(0);
    const text = out.join('');
    expect(text).toMatch(/Usage: peek audit verify/);
    expect(text).toMatch(/--json/);
    expect(text).toMatch(/--dir <path>/);
    expect(text).toMatch(/tail-tampered/);
  });

  it('exits 2 for a tail-tampered chain (final entry modified)', async () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // biome-ignore lint/style/noNonNullAssertion: lines has 3 entries (filtered)
    const obj = JSON.parse(lines[2]!);
    obj.tool = 'tampered';
    lines[2] = JSON.stringify(obj);
    writeFileSync(join(dir, 'audit.log'), `${lines.join('\n')}\n`);
    writeFileSync(join(dir, 'audit.head.json'), JSON.stringify(head));
    const out: string[] = [];
    const code = await runAuditVerify(['--dir', dir, '--json'], (s) => out.push(s));
    expect(code).toBe(2);
    expect(JSON.parse(out.join('')).status).toBe('tail-tampered');
  });

  it('degrades to head-missing (exit 0) when the head file is corrupt', async () => {
    const { buf } = chainLog(2);
    writeFileSync(join(dir, 'audit.log'), buf);
    writeFileSync(join(dir, 'audit.head.json'), '{ this is not json');
    const out: string[] = [];
    const code = await runAuditVerify(['--dir', dir, '--json'], (s) => out.push(s));
    expect(code).toBe(0);
    expect(JSON.parse(out.join('')).status).toBe('head-missing');
  });
});
