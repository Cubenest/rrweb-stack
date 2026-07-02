import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAuditBundle } from '../src/commands/audit-bundle.js';
import { runAudit } from '../src/commands/audit.js';
import { unpackAuditBundle, verifyAuditBundleIntegrity } from '../src/lib/audit-bundle.js';
import { GENESIS_PREV, hashLine } from '../src/lib/audit-chain.js';
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

// P-18 (alpha.7): `--help` is now a declared option on `peek audit log` so it
// doesn't crash parseArgs. The audit command's `--json` was already wired pre-
// alpha.7 — the test below just pins the help behavior.

describe('peek audit log --help (P-18 alpha.7)', () => {
  let home: string;
  let origHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'peek-audit-help-'));
    origHome = process.env.PEEK_HOME;
    process.env.PEEK_HOME = home;
  });

  afterEach(() => {
    // Restore PEEK_HOME — mirror peek-mcp test convention (use '' to mean
    // "unset" since biome's lint/performance/noDelete rules out `delete`).
    if (origHome === undefined) process.env.PEEK_HOME = '';
    else process.env.PEEK_HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('prints usage to stdout and exits 0 without reading the audit log', () => {
    let out = '';
    let err = '';
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stdout.write);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      err += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stderr.write);
    try {
      const code = runAudit(['log', '--help']);
      expect(code).toBe(0);
      expect(err).toBe('');
      expect(out).toContain('peek audit log');
      expect(out).toContain('peek audit verify');
      expect(out).toContain('--since');
      expect(out).toContain('--tool');
      expect(out).toContain('--client');
      expect(out).toContain('--json');
      expect(out).toContain('--help');
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

// ── peek audit bundle command ────────────────────────────────────────────────

function writeBundleChain(dir: string): void {
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
  writeFileSync(join(dir, 'audit.log'), logBuf);
  writeFileSync(join(dir, 'audit.head.json'), JSON.stringify(head));
}

describe('peek audit bundle (command)', () => {
  let dir: string;
  let outDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peek-ab-cmd-'));
    outDir = mkdtempSync(join(tmpdir(), 'peek-ab-out-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it('returns 0 and writes a verifiable .peekaudit when a valid chain is present', async () => {
    writeBundleChain(dir);
    const out = join(outDir, 'evidence.peekaudit');
    const code = await runAuditBundle(['--dir', dir, '--out', out], () => {});
    expect(code).toBe(0);
    const unpacked = unpackAuditBundle(out);
    expect(() => verifyAuditBundleIntegrity(unpacked)).not.toThrow();
  });

  it('returns 1 when --dir has no audit.log', async () => {
    const code = await runAuditBundle(['--dir', dir], () => {});
    expect(code).toBe(1);
  });
});
