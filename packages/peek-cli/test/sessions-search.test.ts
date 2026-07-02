// Command-level tests for `peek sessions search`. Drives `runSessions` directly
// with stdout/stderr captured via vi.spyOn; the DB is seeded under a PEEK_HOME
// tmpdir so openDb picks it up automatically.

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

function withCaptured(argv: string[]): { code: number; output: CapturedStdio } {
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
  home = mkdtempSync(join(tmpdir(), 'peek-cli-search-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});

afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function seedDb(): void {
  const dbPath = join(home, 'sessions.db');
  mkdirSync(home, { recursive: true });
  const db = openDb({ path: dbPath });
  try {
    db.prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      's_login',
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
      's_checkout',
      '2026-05-26T11:00:00.000Z',
      '2026-05-26T11:05:00.000Z',
      'https://app.test/checkout',
      'Checkout Flow',
      'https://app.test',
      99,
      8192,
      'finalized',
    );
    db.prepare(
      `INSERT INTO sessions
         (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      's_errors',
      '2026-05-26T12:00:00.000Z',
      '2026-05-26T12:10:00.000Z',
      'https://app.test/pay',
      'Payment',
      'https://app.test',
      55,
      2048,
      'finalized',
    );
    // Seed console error on s_errors
    db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message) VALUES (?, ?, ?, ?)',
    ).run('s_errors', 1_716_720_600_000, 'error', 'TypeError: cannot read property');
    // Seed network error on s_errors
    db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status, error_text) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('s_errors', 1_716_720_601_000, 'POST', 'https://app.test/api/pay', 500, null);
  } finally {
    db.close();
  }
}

describe('peek sessions search --json', () => {
  it('returns all sessions when no filters are given', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--json']);
    expect(code).toBe(0);
    expect(output.stderr).toBe('');
    const parsed = JSON.parse(output.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it('filters by --q matching title substring (case-insensitive)', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--q', 'checkout', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout) as Array<{ id: string }>;
    expect(parsed.map((r) => r.id)).toEqual(['s_checkout']);
  });

  it('--q match includes url and origin fields as well', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--q', 'login', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout) as Array<{ id: string }>;
    expect(parsed.map((r) => r.id)).toContain('s_login');
  });

  it('--errors any returns sessions with console or network errors', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--errors', 'any', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout) as Array<{ id: string }>;
    expect(parsed.map((r) => r.id)).toContain('s_errors');
    // sessions without errors must be excluded
    expect(parsed.map((r) => r.id)).not.toContain('s_login');
    expect(parsed.map((r) => r.id)).not.toContain('s_checkout');
  });

  it('--errors console returns only sessions with console errors', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--errors', 'console', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout) as Array<{ id: string }>;
    expect(parsed.map((r) => r.id)).toEqual(['s_errors']);
  });

  it('--errors network returns only sessions with network errors', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--errors', 'network', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout) as Array<{ id: string }>;
    expect(parsed.map((r) => r.id)).toEqual(['s_errors']);
  });

  it('JSON rows include console_count and network_count fields', () => {
    seedDb();
    const { output } = withCaptured(['search', '--errors', 'any', '--json']);
    const parsed = JSON.parse(output.stdout) as Array<Record<string, unknown>>;
    for (const row of parsed) {
      expect(typeof row.console_count).toBe('number');
      expect(typeof row.network_count).toBe('number');
    }
    const errRow = parsed.find((r) => r.id === 's_errors');
    expect(errRow?.console_count).toBe(1);
    expect(errRow?.network_count).toBe(1);
  });

  it('emits an empty JSON array and exits 0 when nothing matches', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--q', 'zzznomatch', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdout);
    expect(parsed).toEqual([]);
  });

  it('respects --limit', () => {
    seedDb();
    const { output } = withCaptured(['search', '--limit', '1', '--json']);
    const parsed = JSON.parse(output.stdout);
    expect(parsed).toHaveLength(1);
  });

  it('filters by --status', () => {
    seedDb();
    const { output } = withCaptured(['search', '--status', 'finalized', '--json']);
    const parsed = JSON.parse(output.stdout) as Array<{ id: string }>;
    expect(parsed.length).toBeGreaterThan(0);
    for (const row of parsed) {
      expect(row.id).toBeTruthy();
    }
  });
});

describe('peek sessions search human table', () => {
  it('prints a header with ERRORS column when results exist', () => {
    seedDb();
    const { code, output } = withCaptured(['search']);
    expect(code).toBe(0);
    expect(output.stderr).toBe('');
    expect(output.stdout).toContain('ERRORS');
    expect(output.stdout).toContain('ID');
    expect(output.stdout).toContain('ORIGIN');
  });

  it('prints "No sessions matched." when nothing matches', () => {
    seedDb();
    const { code, output } = withCaptured(['search', '--q', 'zzznomatch']);
    expect(code).toBe(0);
    expect(output.stdout).toContain('No sessions matched.');
  });
});

describe('peek sessions search --help', () => {
  it('prints usage and exits 0', () => {
    const { code, output } = withCaptured(['search', '--help']);
    expect(code).toBe(0);
    expect(output.stderr).toBe('');
    expect(output.stdout).toContain('Usage: peek sessions search');
    expect(output.stdout).toContain('--q');
    expect(output.stdout).toContain('--errors');
    expect(output.stdout).toContain('--since');
    expect(output.stdout).toContain('--until');
    expect(output.stdout).toContain('--status');
    expect(output.stdout).toContain('--limit');
    expect(output.stdout).toContain('--json');
    expect(output.stdout).toContain('--help');
  });

  it('does not open the DB when --help is passed', () => {
    // No seeding — if DB is opened on a path where it doesn't exist, auto-create
    // runs migrations. We verify the output is ONLY the usage text.
    const { code, output } = withCaptured(['search', '--help']);
    expect(code).toBe(0);
    expect(output.stdout).not.toContain('No sessions matched.');
    expect(output.stdout).not.toContain('ID');
  });
});

describe('peek sessions search validation', () => {
  it('returns 1 and prints error for invalid --status', () => {
    const { code, output } = withCaptured(['search', '--status', 'bogus']);
    expect(code).toBe(1);
    expect(output.stderr).toContain('--status');
  });

  it('returns 1 and prints error for invalid --errors', () => {
    const { code, output } = withCaptured(['search', '--errors', 'bogus']);
    expect(code).toBe(1);
    expect(output.stderr).toContain('--errors');
  });

  it('returns 1 and prints error for --limit 0', () => {
    const { code, output } = withCaptured(['search', '--limit', '0']);
    expect(code).toBe(1);
    expect(output.stderr).toContain('--limit');
  });

  it('returns 1 and prints error for --limit with non-integer', () => {
    const { code, output } = withCaptured(['search', '--limit', 'abc']);
    expect(code).toBe(1);
    expect(output.stderr).toContain('--limit');
  });

  it('returns 1 and prints error for an invalid --since literal', () => {
    const { code, output } = withCaptured(['search', '--since', '202-05-01']);
    expect(code).toBe(1);
    expect(output.stderr).toContain('--since');
  });

  it('accepts a valid ISO --since (returns 0)', () => {
    seedDb();
    const { code } = withCaptured(['search', '--since', '2026-06-01', '--json']);
    expect(code).toBe(0);
  });

  it('accepts a duration --since (returns 0)', () => {
    seedDb();
    const { code } = withCaptured(['search', '--since', '7d', '--json']);
    expect(code).toBe(0);
  });
});

describe('peek sessions top-level usage includes search', () => {
  it('includes search in the sessions usage', () => {
    const { code, output } = withCaptured(['--help']);
    expect(code).toBe(0);
    expect(output.stdout).toContain('search');
  });
});
