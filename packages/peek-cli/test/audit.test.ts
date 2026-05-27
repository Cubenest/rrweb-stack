import { describe, expect, it } from 'vitest';
import { filterAuditEntries, parseAuditLog } from '../src/lib/audit.js';

const LOG = [
  JSON.stringify({
    ts: '2026-05-26T10:00:00.000Z',
    tool: 'execute_action',
    args: { type: 'click', selector: '#submit' },
    approvalTs: '2026-05-26T09:59:58.000Z',
    approver: 'user',
    client: 'claude-code',
    sessionId: 's_1',
    result: 'ok',
  }),
  '',
  JSON.stringify({
    ts: '2026-05-26T11:00:00.000Z',
    tool: 'execute_action',
    client: 'cursor',
    result: 'error',
  }),
  JSON.stringify({
    ts: '2026-05-26T12:00:00.000Z',
    tool: 'request_authorization',
    client: 'claude-code',
    result: 'ok',
  }),
].join('\n');

describe('parseAuditLog', () => {
  it('parses JSONL entries and skips blank lines', () => {
    const { entries, errors } = parseAuditLog(LOG);
    expect(entries).toHaveLength(3);
    expect(errors).toHaveLength(0);
    expect(entries[0]?.tool).toBe('execute_action');
    expect(entries[0]?.client).toBe('claude-code');
  });

  it('collects malformed lines instead of throwing', () => {
    const { entries, errors } = parseAuditLog('{not json}\n{"ts":"2026-01-01T00:00:00Z"}');
    expect(entries).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
  });

  it('rejects non-object JSON and objects without a string ts', () => {
    const { entries, errors } = parseAuditLog('[1,2,3]\n{"tool":"x"}');
    expect(entries).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.error).toMatch(/not a JSON object/);
    expect(errors[1]?.error).toMatch(/missing string "ts"/);
  });

  it('preserves unknown extra fields', () => {
    const { entries } = parseAuditLog('{"ts":"2026-01-01T00:00:00Z","weird":42}');
    expect(entries[0]?.weird).toBe(42);
  });
});

describe('filterAuditEntries', () => {
  const { entries } = parseAuditLog(LOG);

  it('filters by tool', () => {
    const out = filterAuditEntries(entries, { tool: 'request_authorization' });
    expect(out).toHaveLength(1);
    expect(out[0]?.tool).toBe('request_authorization');
  });

  it('filters by client', () => {
    const out = filterAuditEntries(entries, { client: 'cursor' });
    expect(out).toHaveLength(1);
    expect(out[0]?.client).toBe('cursor');
  });

  it('filters by sinceMs (inclusive lower bound)', () => {
    const since = Date.parse('2026-05-26T11:00:00.000Z');
    const out = filterAuditEntries(entries, { sinceMs: since });
    expect(out).toHaveLength(2);
    expect(out.every((e) => Date.parse(e.ts) >= since)).toBe(true);
  });

  it('combines filters (AND semantics)', () => {
    const out = filterAuditEntries(entries, {
      tool: 'execute_action',
      client: 'claude-code',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.sessionId).toBe('s_1');
  });

  it('drops entries with an unparseable ts only when a time bound is active', () => {
    const withBad = [...entries, { ts: 'not-a-date', tool: 'execute_action' }];
    expect(filterAuditEntries(withBad, { tool: 'execute_action' })).toHaveLength(3);
    expect(
      filterAuditEntries(withBad, {
        tool: 'execute_action',
        sinceMs: 0,
      }),
    ).toHaveLength(2);
  });
});
