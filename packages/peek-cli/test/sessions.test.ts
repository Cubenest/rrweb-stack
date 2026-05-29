// Command-level tests for `peek sessions ...` — covers the parseArgs
// hardening from P-18 alpha.7 (--json + --help on `list`; --help on every
// other subcommand). We drive `runSessions` directly and capture stdout to
// verify the output shape (JSON parseable, usage text contains the right
// command name, exit codes).
//
// The shared DB lives under a PEEK_HOME tmpdir for the duration of each test;
// `runSessions` opens it via `@peekdev/mcp/db` which honors PEEK_HOME.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSessions } from '../src/commands/sessions.js';

interface CapturedStdio {
  stdout: string;
  stderr: string;
}

/** Drive `runSessions` with stdout/stderr captured. Restores spies on return. */
async function withCaptured(argv: string[]): Promise<{ code: number; output: CapturedStdio }> {
  const output: CapturedStdio = { stdout: '', stderr: '' };
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    output.stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write);
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    output.stderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stderr.write);
  try {
    const code = runSessions(argv);
    return { code, output };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

let home: string;
let origHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-cli-sessions-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});

afterEach(() => {
  // Restore PEEK_HOME — mirror the peek-mcp test convention (use '' to mean
  // "unset" since biome's lint/performance/noDelete rules out `delete`).
  if (origHome === undefined) process.env.PEEK_HOME = '';
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function seedDb(): void {
  const dbPath = join(home, 'sessions.db');
  mkdirSync(home, { recursive: true });
  const db = openDb({ path: dbPath });
  try {
    // Seed two sessions so the JSON output is a non-trivial array.
    db.prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      's_alpha',
      '2026-05-26T10:00:00.000Z',
      '2026-05-26T10:02:00.000Z',
      'https://app.test/login',
      'Login',
      'https://app.test',
      42,
      4096,
      'finalized',
    );
    db.prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      's_beta',
      '2026-05-26T11:00:00.000Z',
      '2026-05-26T11:05:00.000Z',
      'https://app.test/checkout',
      'Checkout',
      'https://app.test',
      99,
      8192,
      'finalized',
    );
  } finally {
    db.close();
  }
}

// P-18 (alpha.7): `peek sessions list --json` / `--help` MUST NOT crash with
// `TypeError: Unknown option`. Pre-fix, parseArgs rejected both flags.

describe('peek sessions list --json (P-18 alpha.7)', () => {
  it('emits a JSON array of session rows, parseable with JSON.parse', async () => {
    seedDb();
    const { code, output } = await withCaptured(['list', '--json']);
    expect(code).toBe(0);
    expect(output.stderr).toBe('');
    // The output MUST be valid JSON — no human-readable preamble, no errors.
    const parsed = JSON.parse(output.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    // Order: newest first (matches the human-readable table).
    expect(parsed[0]).toMatchObject({
      id: 's_beta',
      origin: 'https://app.test',
      url: 'https://app.test/checkout',
      created_at: '2026-05-26T11:00:00.000Z',
      updated_at: '2026-05-26T11:05:00.000Z',
      event_count: 99,
      bytes: 8192,
      status: 'finalized',
    });
    expect(parsed[1]).toMatchObject({ id: 's_alpha', event_count: 42 });
  });

  it('emits an empty JSON array (not the human "No sessions" string) on a fresh DB', async () => {
    // No DB seeding — openDb still creates the schema. Empty rows expected.
    const { code, output } = await withCaptured(['list', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout);
    expect(parsed).toEqual([]);
  });

  it('respects --limit and --origin together with --json', async () => {
    seedDb();
    const { output } = await withCaptured([
      'list',
      '--limit',
      '1',
      '--origin',
      'https://app.test',
      '--json',
    ]);
    const parsed = JSON.parse(output.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe('s_beta'); // newest first
  });
});

describe('peek sessions list --help (P-18 alpha.7)', () => {
  it('prints subcommand-specific usage to stdout and exits 0', async () => {
    const { code, output } = await withCaptured(['list', '--help']);
    expect(code).toBe(0);
    expect(output.stderr).toBe('');
    expect(output.stdout).toContain('Usage: peek sessions list');
    // The subcommand help must document its actual options.
    expect(output.stdout).toContain('--origin');
    expect(output.stdout).toContain('--limit');
    expect(output.stdout).toContain('--json');
    expect(output.stdout).toContain('--help');
  });

  it('does not open the DB or list sessions when --help is passed', async () => {
    // No DB at all — if --help touched the DB, openDb would auto-create one.
    // We assert behavior by checking the output is ONLY the usage block, not
    // a session table or empty-state message.
    const { code, output } = await withCaptured(['list', '--help']);
    expect(code).toBe(0);
    expect(output.stdout).not.toContain('No sessions recorded yet');
    expect(output.stdout).not.toContain('ID');
  });
});

describe('peek sessions <subcommand> --help (P-18 alpha.7 common treatment)', () => {
  it('show --help prints subcommand usage and exits 0', async () => {
    const { code, output } = await withCaptured(['show', '--help']);
    expect(code).toBe(0);
    expect(output.stdout).toContain('Usage: peek sessions show');
  });

  it('export --help prints subcommand usage including all supported formats', async () => {
    const { code, output } = await withCaptured(['export', '--help']);
    expect(code).toBe(0);
    expect(output.stdout).toContain('Usage: peek sessions export');
    // K.2 (alpha.7): playwright must appear as a supported format.
    expect(output.stdout).toContain('playwright');
    expect(output.stdout).toContain('markdown');
    expect(output.stdout).toContain('json');
  });

  it('delete --help prints subcommand usage and exits 0', async () => {
    const { code, output } = await withCaptured(['delete', '--help']);
    expect(code).toBe(0);
    expect(output.stdout).toContain('Usage: peek sessions delete');
    expect(output.stdout).toContain('--all-older-than');
  });

  it('top-level `peek sessions --help` prints the dispatcher usage', async () => {
    const { code, output } = await withCaptured(['--help']);
    expect(code).toBe(0);
    expect(output.stdout).toContain('Usage: peek sessions');
    expect(output.stdout).toContain('list');
    expect(output.stdout).toContain('show');
    expect(output.stdout).toContain('export');
    expect(output.stdout).toContain('delete');
  });

  // Pre-P-18 regression bait: passing --help anywhere in `peek sessions ...`
  // crashed parseArgs with `TypeError: Unknown option '--help'`. The fix is to
  // declare --help as a known option in EVERY subcommand's parseArgs call.
  it('never throws an "Unknown option" TypeError on --help (the P-18 fatal)', async () => {
    // The TypeError used to escape parseArgs as a synchronous throw, which
    // index.ts would format as "peek: fatal — ...". Since runSessions wraps
    // every subcommand in its own try-free parseArgs, a TypeError here would
    // bubble out of withCaptured. We instead assert clean exit 0 on every
    // subcommand's --help.
    for (const argv of [
      ['list', '--help'],
      ['show', '--help'],
      ['export', '--help'],
      ['delete', '--help'],
    ]) {
      // Test must not throw — exit cleanly with code 0.
      await expect(withCaptured(argv)).resolves.toMatchObject({ code: 0 });
    }
  });
});
