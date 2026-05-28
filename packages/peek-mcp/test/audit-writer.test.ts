import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2);
    // And the JSON itself round-trips.
    expect(JSON.parse(line.trimEnd())).toMatchObject({
      tool: 'execute_action',
      result: 'ok',
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
    });
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({
      tool: 'request_authorization',
      result: 'denied',
    });
    // And the redaction took effect on the second entry.
    expect(JSON.parse(lines[1] ?? '').args.text).toBe('<<REDACTED>>');
  });

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
