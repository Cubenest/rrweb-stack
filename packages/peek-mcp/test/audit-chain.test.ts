import { describe, expect, it } from 'vitest';
import {
  GENESIS_PREV,
  LOCK_GAP_PREV,
  hashLine,
  sha256Hex,
  verifyAuditChain,
} from '../src/native-host/audit-chain.js';
import type { AuditHead } from '../src/native-host/audit-head.js';

describe('audit-chain primitives', () => {
  it('sha256Hex returns lowercase 64-char hex and is deterministic', () => {
    const h = sha256Hex(Buffer.from('hello', 'utf8'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(sha256Hex('hello'));
  });

  it('hashLine ignores exactly one trailing newline', () => {
    expect(hashLine('{"a":1}\n')).toBe(hashLine('{"a":1}'));
    expect(hashLine('{"a":1}\n\n')).not.toBe(hashLine('{"a":1}\n')); // only one stripped
  });

  it('different content yields different hash', () => {
    expect(hashLine('{"a":1}')).not.toBe(hashLine('{"a":2}'));
  });

  // KNOWN-ANSWER VECTOR (will be mirrored verbatim in the peek-cli package to catch drift)
  it('known-answer vector', () => {
    expect(GENESIS_PREV).toBe('peek-audit-genesis-v1');
    expect(LOCK_GAP_PREV).toBe('peek-audit-lockgap-v1');
    // Pinned literal digest so a hash-algorithm change is caught even when both
    // sides of an equality move together; peek-cli mirrors this exact vector.
    const EXPECTED = '546b9e19e7352f1eb907a1c9aa55d945f9e4664238b432c91a297e52e4da0521';
    expect(hashLine('{"seq":1,"prevHash":"peek-audit-genesis-v1"}')).toBe(EXPECTED);
    expect(sha256Hex(Buffer.from('{"seq":1,"prevHash":"peek-audit-genesis-v1"}', 'utf8'))).toBe(
      EXPECTED,
    );
    // Intended edge case (not a bug): hashLine strips exactly one trailing
    // newline, so an empty line and a lone newline hash identically.
    expect(hashLine('')).toBe(hashLine('\n'));
  });
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

describe('verifyAuditChain (ported from @peekdev/cli)', () => {
  it('intact for a well-formed chain', () => {
    const { buf, head } = chainLog(3);
    const r = verifyAuditChain(buf, head);
    expect(r.status).toBe('intact');
    expect(r.entriesVerified).toBe(3);
  });
  it('broken at the edited line', () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n');
    const obj = JSON.parse(lines[1] as string);
    obj.tool = 'tampered';
    lines[1] = JSON.stringify(obj);
    const r = verifyAuditChain(Buffer.from(lines.join('\n'), 'utf8'), head);
    expect(r.status).toBe('broken');
    expect(r.brokenAtLine).toBe(3);
  });
  it('truncated when the file is shorter than the head', () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const truncated = Buffer.from(`${lines.slice(0, 2).join('\n')}\n`, 'utf8');
    expect(verifyAuditChain(truncated, head).status).toBe('truncated');
  });
  it('tail-tampered when the final entry body is edited but seq/prevHash kept', () => {
    const { buf, head } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const obj = JSON.parse(lines[2] as string);
    obj.tool = 'tampered';
    lines[2] = JSON.stringify(obj);
    const r = verifyAuditChain(Buffer.from(`${lines.join('\n')}\n`, 'utf8'), head);
    expect(r.status).toBe('tail-tampered');
    expect(r.expected).toBe(head.headHash);
  });
  it('prefix-tampered when the sealed prelude changed', () => {
    const prelude = '{"ts":"old","tool":"x"}\n';
    const head: AuditHead = {
      version: 1,
      prefix: { bytes: Buffer.byteLength(prelude), sha256: sha256Hex(Buffer.from('DIFFERENT')) },
      seq: 0,
      headHash: GENESIS_PREV,
      gapCount: 0,
      bytes: Buffer.byteLength(prelude),
    };
    expect(verifyAuditChain(Buffer.from(prelude, 'utf8'), head).status).toBe('prefix-tampered');
  });
  it('head-missing when no head is provided', () => {
    const { buf } = chainLog(2);
    const r = verifyAuditChain(buf, null);
    expect(r.status).toBe('head-missing');
    expect(r.entriesVerified).toBe(2);
  });
  it('incomplete-final for an unterminated last line', () => {
    const { buf, head } = chainLog(2);
    const partial = Buffer.concat([buf, Buffer.from('{"ts":"t3","seq":3,"prevHash"', 'utf8')]);
    const r = verifyAuditChain(partial, head);
    expect(r.status).toBe('incomplete-final');
    expect(r.entriesVerified).toBe(2);
  });
  it('gaps for a chained line whose prevHash is LOCK_GAP_PREV', () => {
    const l1 = JSON.stringify({ ts: 't1', seq: 1, prevHash: GENESIS_PREV });
    const l2 = JSON.stringify({ ts: 't2', seq: 2, prevHash: LOCK_GAP_PREV });
    const buf = Buffer.from(`${l1}\n${l2}\n`, 'utf8');
    const head = {
      version: 1,
      prefix: null,
      seq: 2,
      headHash: hashLine(l2),
      gapCount: 1,
      bytes: buf.length,
    };
    const r = verifyAuditChain(buf, head as AuditHead);
    expect(r.status).toBe('gaps');
    expect(r.gaps).toEqual([2]);
  });
  it('intact when head benignly lags one entry behind the log tail', () => {
    const { buf } = chainLog(3);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    // Writer appended line 3 but crashed before advancing the head → head still at seq 2.
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
});
