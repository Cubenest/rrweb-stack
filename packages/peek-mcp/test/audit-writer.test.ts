import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GENESIS_PREV, LOCK_GAP_PREV, hashLine } from '../src/native-host/audit-chain.js';
import { auditHeadPath, auditLockPath, readHead } from '../src/native-host/audit-head.js';
import {
  appendAuditEntry,
  buildAuditEntry,
  recordAuditEntry,
  serializeAuditEntry,
} from '../src/native-host/audit.js';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'peek-audit-'));
});
afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('buildAuditEntry', () => {
  it('emits ISO timestamps + redacts a TypeAction text', () => {
    const entry = buildAuditEntry({
      tool: 'execute_action',
      action: { type: 'type', selector: '#pw', text: 'hunter2', delay: 40 },
      approver: 'user',
      client: 'cursor',
      sessionId: 's_abc',
      result: 'ok',
      nowMs: 1716480000000,
      approvalMs: 1716479999500,
    });
    expect(entry.ts).toBe('2024-05-23T16:00:00.000Z');
    expect(entry.approvalTs).toBe('2024-05-23T15:59:59.500Z');
    expect(entry.args).toEqual({
      type: 'type',
      selector: '#pw',
      text: '<<REDACTED>>',
      delay: 40,
    });
    expect(entry.tool).toBe('execute_action');
    expect(entry.approver).toBe('user');
    expect(entry.client).toBe('cursor');
    expect(entry.sessionId).toBe('s_abc');
    expect(entry.result).toBe('ok');
    // buildAuditEntry produces a DRAFT — it never sets the chain fields.
    expect('seq' in entry).toBe(false);
    expect('prevHash' in entry).toBe(false);
  });

  it('omits approvalTs when no user-approval timestamp is given', () => {
    const entry = buildAuditEntry({
      tool: 'execute_action',
      action: { type: 'click', selector: '#a', button: 'left' },
      approver: 'level-4-auto',
      client: 'claude-code',
      sessionId: 's_yolo',
      result: 'ok',
      nowMs: 0,
    });
    expect('approvalTs' in entry).toBe(false);
  });

  it('preserves the destructive-term + error fields when given', () => {
    const entry = buildAuditEntry({
      tool: 'execute_action',
      action: { type: 'click', selector: '#del', button: 'left' },
      approver: 'user',
      client: 'cursor',
      sessionId: 's_x',
      result: 'denied',
      nowMs: 0,
      destructiveTerm: 'delete',
      error: 'User denied',
    });
    expect(entry.destructiveTerm).toBe('delete');
    expect(entry.error).toBe('User denied');
  });

  it('serializes the full §H3 line shape for a confirmToken-backed destructive action', () => {
    // A real execute_action that consumed a confirmToken + the user approved a
    // destructive click. The token itself is NEVER persisted (not an AuditEntry
    // field) — only the approver/approvalTs/destructiveTerm/redacted-args land.
    const entry = buildAuditEntry({
      tool: 'execute_action',
      action: { type: 'click', selector: '#delete-account', button: 'left' },
      approver: 'user',
      client: 'cursor',
      sessionId: 's_acct',
      result: 'ok',
      nowMs: 1716480000000,
      approvalMs: 1716480001500,
      destructiveTerm: 'delete',
    });
    const line = serializeAuditEntry({ ...entry, seq: 1, prevHash: GENESIS_PREV });
    const parsed = JSON.parse(line.trimEnd());
    expect(parsed).toMatchObject({
      ts: '2024-05-23T16:00:00.000Z',
      tool: 'execute_action',
      approvalTs: '2024-05-23T16:00:01.500Z',
      approver: 'user',
      client: 'cursor',
      sessionId: 's_acct',
      result: 'ok',
      destructiveTerm: 'delete',
      args: { type: 'click', selector: '#delete-account', button: 'left' },
    });
    // The token must not leak into the audit log under any key.
    expect(line).not.toContain('confirmToken');
    expect(line).not.toContain('token');
  });

  it('redacts NavigateAction query-string values', () => {
    const entry = buildAuditEntry({
      tool: 'execute_action',
      action: { type: 'navigate', url: 'https://x.test/?token=sk-live-abc' },
      approver: 'user',
      client: 'cursor',
      sessionId: 's_n',
      result: 'ok',
      nowMs: 0,
    });
    const args = entry.args as { type: 'navigate'; url: string };
    expect(args.url).toContain('%3C%3CREDACTED%3E%3E');
  });

  it('accepts the connector-elicit approver (SP3b delegated consent)', () => {
    const entry = buildAuditEntry({
      tool: 'execute_action',
      action: { type: 'click', selector: '#a', button: 'left' },
      approver: 'connector-elicit',
      client: 'cursor',
      sessionId: 's_elicit',
      result: 'ok',
      nowMs: 0,
    });
    expect(entry.approver).toBe('connector-elicit');
  });

  it('accepts tool:request_pairing (SP4 connector pairing)', () => {
    const entry = buildAuditEntry({
      tool: 'request_pairing',
      // request_pairing has no DOM action; args is a neutral marker object.
      action: { type: 'pair_request' } as never,
      approver: 'user',
      client: 'test-connector',
      sessionId: '',
      result: 'ok',
      nowMs: 1716480000000,
    });
    expect(entry.tool).toBe('request_pairing');
    expect(entry.result).toBe('ok');
    expect(entry.client).toBe('test-connector');
    // The pairing audit entry must NEVER expose a secret — it has none here.
    const line = serializeAuditEntry({ ...entry, seq: 1, prevHash: GENESIS_PREV });
    expect(line).not.toContain('secret');
  });
});

describe('serializeAuditEntry', () => {
  it('produces a single JSON line with a trailing newline', () => {
    const line = serializeAuditEntry({
      ts: '2025-01-01T00:00:00.000Z',
      tool: 'execute_action',
      args: { type: 'click' },
      approver: 'user',
      client: 'cursor',
      sessionId: 's',
      result: 'ok',
      seq: 1,
      prevHash: GENESIS_PREV,
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2);
    // And the JSON itself round-trips.
    expect(JSON.parse(line.trimEnd())).toMatchObject({
      tool: 'execute_action',
      result: 'ok',
      seq: 1,
      prevHash: GENESIS_PREV,
    });
  });
});

describe('appendAuditEntry / recordAuditEntry', () => {
  it('appends one JSONL line per call (creating dirs as needed)', () => {
    const path = join(workdir, 'nested', 'audit.log');
    const built = recordAuditEntry(
      {
        tool: 'execute_action',
        action: { type: 'click', selector: '#a', button: 'left' },
        approver: 'user',
        client: 'cursor',
        sessionId: 's_1',
        result: 'ok',
        nowMs: 1716480000000,
      },
      { path },
    );
    recordAuditEntry(
      {
        tool: 'request_authorization',
        action: { type: 'type', selector: '#a', text: 'secret', delay: 40 },
        approver: 'user',
        client: 'cursor',
        sessionId: 's_1',
        result: 'denied',
        nowMs: 1716480001000,
      },
      { path },
    );
    expect(existsSync(path)).toBe(true);
    const contents = readFileSync(path, 'utf8');
    const lines = contents.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      tool: 'execute_action',
      result: 'ok',
      ts: built.ts,
      seq: 1,
    });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({
      tool: 'request_authorization',
      result: 'denied',
      seq: 2,
    });
    // And the redaction took effect on the second entry.
    expect(JSON.parse(lines[1] ?? '').args.text).toBe('<<REDACTED>>');
  });

  it.skipIf(process.platform === 'win32')(
    'creates the audit log with mode 0o600 on first write (POSIX only)',
    () => {
      const path = join(workdir, 'audit.log');
      // Write twice — first creates with 0o600, second is a plain append.
      appendAuditEntry(
        {
          ts: '2025-01-01T00:00:00.000Z',
          tool: 'execute_action',
          args: { type: 'reload' },
          approver: 'user',
          client: 'cursor',
          sessionId: 's_first',
          result: 'ok',
        },
        { path },
      );
      appendAuditEntry(
        {
          ts: '2025-01-01T00:00:01.000Z',
          tool: 'execute_action',
          args: { type: 'reload' },
          approver: 'user',
          client: 'cursor',
          sessionId: 's_second',
          result: 'ok',
        },
        { path },
      );
      const stat = statSync(path);
      expect(stat.mode & 0o777).toBe(0o600);
      // And both lines made it.
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
    },
  );

  it('appendAuditEntry is additive across many writes (append-only)', () => {
    const path = join(workdir, 'audit.log');
    for (let i = 0; i < 5; i++) {
      appendAuditEntry(
        {
          ts: new Date(1716480000000 + i * 1000).toISOString(),
          tool: 'execute_action',
          args: { type: 'reload' },
          approver: 'user',
          client: 'cursor',
          sessionId: `s_${i}`,
          result: 'ok',
        },
        { path },
      );
    }
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(JSON.parse(lines[i] ?? '').sessionId).toBe(`s_${i}`);
    }
  });
});

describe('audit hash-chain', () => {
  function input(sessionId: string, nowMs: number) {
    return {
      tool: 'execute_action' as const,
      action: { type: 'click' as const, selector: '#a', button: 'left' as const },
      approver: 'user' as const,
      client: 'cursor',
      sessionId,
      result: 'ok' as const,
      nowMs,
    };
  }

  it('seeds the first chained line with seq 1 and the genesis prevHash', () => {
    const path = join(workdir, 'audit.log');
    const entry = recordAuditEntry(input('s_1', 1716480000000), { path });
    expect(entry.seq).toBe(1);
    expect(entry.prevHash).toBe(GENESIS_PREV);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0] ?? '') as { seq: number; prevHash: string };
    expect(parsed.seq).toBe(1);
    expect(parsed.prevHash).toBe(GENESIS_PREV);
  });

  it('links two successive writes into a linear chain', () => {
    const path = join(workdir, 'audit.log');
    const a = recordAuditEntry(input('s_1', 1716480000000), { path });
    const b = recordAuditEntry(input('s_2', 1716480001000), { path });
    expect(b.seq).toBe(a.seq + 1);
    const rawA = `${readFileSync(path, 'utf8').split('\n').filter(Boolean)[0]}\n`;
    expect(b.prevHash).toBe(hashLine(rawA));
  });

  it('records a head file with seq and a byte count matching the log size', () => {
    const path = join(workdir, 'audit.log');
    recordAuditEntry(input('s_1', 1716480000000), { path });
    const headPath = auditHeadPath(path);
    expect(existsSync(headPath)).toBe(true);
    const head = readHead(headPath);
    expect(head).not.toBeNull();
    expect(head?.seq).toBe(1);
    expect(head?.bytes).toBe(statSync(path).size);
  });

  it('seals a pre-existing unchained log line as the prefix', () => {
    const path = join(workdir, 'audit.log');
    const legacy = `${JSON.stringify({ ts: '2025-01-01T00:00:00.000Z', tool: 'execute_action', args: { type: 'reload' }, approver: 'user', client: 'cursor', sessionId: 's_legacy', result: 'ok' })}\n`;
    const legacyBytes = Buffer.byteLength(legacy, 'utf8');
    // Write the legacy (unchained) line directly, bypassing the chained writer.
    writeFileSync(path, legacy, { mode: 0o600 });
    const entry = recordAuditEntry(input('s_new', 1716480000000), { path });
    expect(entry.seq).toBe(1);
    expect(entry.prevHash).toBe(GENESIS_PREV);
    const head = readHead(auditHeadPath(path));
    expect(head?.prefix?.bytes).toBe(legacyBytes);
  });

  it('writes a gap line (LOCK_GAP_PREV) when the lock cannot be acquired', () => {
    const path = join(workdir, 'audit.log');
    const lockFd = openSync(auditLockPath(path), 'wx'); // hold the lock
    try {
      const entry = recordAuditEntry(input('s_gap', 1716480000000), {
        path,
        lock: { maxWaitMs: 40, retryMs: 10, staleMs: 9999 },
      });
      expect(entry.prevHash).toBe(LOCK_GAP_PREV);
      const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
    } finally {
      closeSync(lockFd);
      rmSync(auditLockPath(path), { force: true });
    }
  });

  it('rebuilds (not reseals) the chain when the head is missing on an already-chained log', () => {
    const path = join(workdir, 'audit.log');
    // Two real chained entries via the writer.
    recordAuditEntry(input('s_1', 1716480000000), { path });
    recordAuditEntry(input('s_2', 1716480001000), { path });
    // Simulate a deleted/lost head file (the log itself is untouched + chained).
    const headPath = auditHeadPath(path);
    rmSync(headPath, { force: true });
    expect(existsSync(headPath)).toBe(false);

    const third = recordAuditEntry(input('s_3', 1716480002000), { path });

    // It must chain off the REAL tail (line 2), not restart at seq 1.
    expect(third.seq).toBe(3);
    const rawLines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    expect(rawLines).toHaveLength(3);
    expect(third.prevHash).toBe(hashLine(`${rawLines[1] ?? ''}\n`));

    // And the rebuilt head must NOT seal the chained log as a legacy prefix.
    const head = readHead(headPath);
    expect(head).not.toBeNull();
    expect(head?.prefix).toBeNull();
    expect(head?.seq).toBe(3);
  });

  it('a normal write after a gap line chains off the gap line and counts the gap', () => {
    const logPath = join(workdir, 'audit.log');
    const headPath = auditHeadPath(logPath);
    const baseInput = input('s_gapheal', 1716480000000);
    const fd = openSync(auditLockPath(logPath), 'wx'); // hold the lock → force a gap line
    let gap: ReturnType<typeof recordAuditEntry>;
    try {
      gap = recordAuditEntry(baseInput, {
        path: logPath,
        lock: { maxWaitMs: 40, retryMs: 10, staleMs: 9999 },
      });
    } finally {
      closeSync(fd);
      rmSync(auditLockPath(logPath), { force: true }); // release so the next write can lock
    }
    expect(gap.prevHash).toBe(LOCK_GAP_PREV);

    const next = recordAuditEntry(baseInput, { path: logPath }); // normal locked write
    const rawLines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    expect(next.prevHash).toBe(hashLine(rawLines[0] ?? '')); // chains off the gap line's bytes
    const head = JSON.parse(readFileSync(headPath, 'utf8'));
    expect(head.gapCount).toBe(1);
    expect(head.seq).toBe(next.seq);
  });
});
