import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GENESIS_PREV,
  LOCK_GAP_PREV,
  hashLine,
  sha256Hex,
} from '../src/native-host/audit-chain.js';
import {
  initHead,
  readHead,
  rebuildHeadFromLog,
  writeHeadAtomic,
} from '../src/native-host/audit-head.js';

let dir: string;
let logPath: string;
let headPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-head-'));
  logPath = join(dir, 'audit.log');
  headPath = join(dir, 'audit.head.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('audit-head', () => {
  it('readHead returns null when absent', () => {
    expect(readHead(headPath)).toBeNull();
  });

  it('initHead on an absent/empty log yields a null prefix at seq 0', () => {
    const head = initHead(logPath);
    expect(head).toEqual({
      version: 1,
      prefix: null,
      seq: 0,
      headHash: GENESIS_PREV,
      gapCount: 0,
      bytes: 0,
    });
  });

  it('initHead seals an existing unchained log into a prefix', () => {
    const existing = '{"ts":"t","tool":"x"}\n{"ts":"u","tool":"y"}\n';
    writeFileSync(logPath, existing);
    const head = initHead(logPath);
    expect(head.prefix).toEqual({
      bytes: Buffer.byteLength(existing, 'utf8'),
      sha256: sha256Hex(Buffer.from(existing, 'utf8')),
    });
    expect(head.bytes).toBe(Buffer.byteLength(existing, 'utf8'));
    expect(head.seq).toBe(0);
    expect(head.headHash).toBe(GENESIS_PREV);
  });

  it('writeHeadAtomic round-trips and writes mode 0600 (POSIX)', () => {
    const head = {
      version: 1 as const,
      prefix: null,
      seq: 3,
      headHash: 'abc',
      gapCount: 0,
      bytes: 120,
      updatedAt: 't',
    };
    writeHeadAtomic(headPath, head);
    expect(readHead(headPath)).toEqual(head);
    if (process.platform !== 'win32') {
      expect(statSync(headPath).mode & 0o777).toBe(0o600);
    }
  });

  it('rebuildHeadFromLog re-derives seq + headHash from the last chained line', () => {
    const l1 = JSON.stringify({ ts: 't', tool: 'x', seq: 1, prevHash: GENESIS_PREV });
    const l2 = JSON.stringify({ ts: 'u', tool: 'y', seq: 2, prevHash: hashLine(l1) });
    writeFileSync(logPath, `${l1}\n${l2}\n`);
    const head = rebuildHeadFromLog(logPath, null);
    expect(head.seq).toBe(2);
    expect(head.headHash).toBe(hashLine(l2));
    expect(head.prefix).toBeNull();
    expect(head.bytes).toBe(statSync(logPath).size);
  });

  it('rebuildHeadFromLog counts lock-gap lines via the LOCK_GAP_PREV constant', () => {
    const l1 = JSON.stringify({ ts: 't', seq: 1, prevHash: GENESIS_PREV });
    const l2 = JSON.stringify({ ts: 'u', seq: 2, prevHash: LOCK_GAP_PREV });
    writeFileSync(logPath, `${l1}\n${l2}\n`);
    const head = rebuildHeadFromLog(logPath, null);
    expect(head.gapCount).toBe(1);
    expect(head.seq).toBe(2);
  });

  it('rebuildHeadFromLog walks only the chained region after the prefix', () => {
    const prelude = '{"ts":"old"}\n';
    const l1 = JSON.stringify({ ts: 't', seq: 1, prevHash: GENESIS_PREV });
    writeFileSync(logPath, `${prelude}${l1}\n`);
    const prefix = {
      bytes: Buffer.byteLength(prelude, 'utf8'),
      sha256: sha256Hex(Buffer.from(prelude, 'utf8')),
    };
    const head = rebuildHeadFromLog(logPath, prefix);
    expect(head.seq).toBe(1);
    expect(head.headHash).toBe(hashLine(l1));
    expect(head.prefix).toEqual(prefix);
  });
});
