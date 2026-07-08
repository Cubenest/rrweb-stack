// Tests for `peek connect <add|list|remove>` verbs + top-level routing.
// Registry path injection: each test passes a tmp connectors.json path via
// PEEK_HOME so peekHomeDir() resolves to a temp directory. This mirrors the
// pattern used in sessions.import.test.ts and lib/import-session.test.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../index.js';
import { readConnectors } from '../lib/connect/registry.js';
import { runConnect } from './connect.js';

let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-connect-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});

afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── helpers ────────────────────────────────────────────────────────────────

function silenced(): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    out.push(typeof s === 'string' ? s : s.toString());
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    err.push(typeof s === 'string' ? s : s.toString());
    return true;
  });
  return { out, err };
}

// ── add ────────────────────────────────────────────────────────────────────

describe('peek connect add', () => {
  it('adds a known surface (slack) and returns 0', async () => {
    const { out } = silenced();
    const code = await runConnect(['add', 'slack']);
    expect(code).toBe(0);

    // Default name is surface name when --name omitted
    const file = readConnectors();
    const names = Object.keys(file.connectors);
    expect(names).toHaveLength(1);
    const entry = file.connectors[names[0] as string];
    expect(entry?.surface).toBe('slack');
    expect(entry?.enabled).toBe(true);

    // Prints the interactive-setup guidance
    const combined = out.join('');
    expect(combined).toMatch(/interactively/);
    expect(combined).toMatch(/peek connect start/);
  });

  it('supports --name override', async () => {
    silenced();
    const code = await runConnect(['add', 'slack', '--name', 'my-slack']);
    expect(code).toBe(0);

    const file = readConnectors();
    expect(Object.keys(file.connectors)).toContain('my-slack');
  });

  it('rejects unknown surface with no --command (returns 1)', async () => {
    const { err } = silenced();
    const code = await runConnect(['add', 'unknown-surface-xyz']);
    expect(code).toBe(1);
    expect(err.join('')).toMatch(/unknown-surface-xyz/);
  });

  it('accepts unknown surface when --command is provided', async () => {
    silenced();
    const code = await runConnect(['add', 'custom', '--command', 'my-connector-bin']);
    expect(code).toBe(0);

    const file = readConnectors();
    const entry = file.connectors.custom;
    expect(entry?.command).toBe('my-connector-bin');
  });

  it('stores --args when provided', async () => {
    silenced();
    // parseArgs requires flag-like arg values to use = syntax to avoid ambiguity
    const code = await runConnect(['add', 'slack', '--args=--token', '--args=xoxb-test']);
    expect(code).toBe(0);

    const file = readConnectors();
    const entry = Object.values(file.connectors)[0];
    expect(entry?.args).toEqual(['--token', 'xoxb-test']);
  });
});

// ── list ───────────────────────────────────────────────────────────────────

describe('peek connect list', () => {
  it('prints "no connectors configured" when empty, returns 0', async () => {
    const { out } = silenced();
    const code = await runConnect(['list']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/no connectors configured/);
  });

  it('prints each connector name + surface + enabled, returns 0', async () => {
    const { out } = silenced();
    await runConnect(['add', 'slack']);
    vi.restoreAllMocks();

    const { out: out2 } = silenced();
    const code = await runConnect(['list']);
    expect(code).toBe(0);
    const combined = out2.join('');
    expect(combined).toMatch(/slack/);
    expect(combined).toMatch(/enabled/);
    // suppress unused-variable warning for `out`
    void out;
  });
});

// ── remove ─────────────────────────────────────────────────────────────────

describe('peek connect remove', () => {
  it('removes an existing connector and returns 0', async () => {
    silenced();
    await runConnect(['add', 'slack']);
    vi.restoreAllMocks();

    silenced();
    const code = await runConnect(['remove', 'slack']);
    expect(code).toBe(0);

    const file = readConnectors();
    expect(Object.keys(file.connectors)).toHaveLength(0);
  });

  it('no-ops gracefully if name absent, returns 0', async () => {
    silenced();
    const code = await runConnect(['remove', 'nonexistent']);
    expect(code).toBe(0);
  });
});

// ── lifecycle stubs ────────────────────────────────────────────────────────

describe('peek connect lifecycle stubs', () => {
  it.each(['start', 'stop', 'status', 'logs', '__supervise'])(
    '%s returns 0 (not-yet-implemented stub)',
    async (sub) => {
      silenced();
      const code = await runConnect([sub]);
      expect(code).toBe(0);
    },
  );
});

// ── unknown sub + help ─────────────────────────────────────────────────────

describe('peek connect unknown / help', () => {
  it('unknown subcommand prints usage and returns 1', async () => {
    const { out, err } = silenced();
    const code = await runConnect(['definitely-not-a-verb']);
    expect(code).toBe(1);
    // usage appears on stdout or stderr
    const combined = out.join('') + err.join('');
    expect(combined).toMatch(/peek connect/);
  });

  it('no subcommand prints usage and returns 1', async () => {
    const { out } = silenced();
    const code = await runConnect([]);
    expect(code).toBe(1);
    expect(out.join('')).toMatch(/peek connect/);
  });

  it('--help / help returns 0', async () => {
    const { out } = silenced();
    const code = await runConnect(['help']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/peek connect/);
  });
});

// ── top-level routing ──────────────────────────────────────────────────────

describe('run() routing', () => {
  it('routes `connect list` to runConnect', async () => {
    const { out } = silenced();
    const code = await run(['connect', 'list']);
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/no connectors configured/);
  });

  it('peek connect appears in top-level help', async () => {
    const { out } = silenced();
    await run(['--help']);
    expect(out.join('')).toMatch(/connect/);
  });
});
