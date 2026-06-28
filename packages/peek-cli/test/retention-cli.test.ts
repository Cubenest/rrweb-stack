import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runRetention } from '../src/commands/retention.js';
import { confirm } from '../src/lib/prompt.js';
import { loadPolicy } from '../src/lib/retention.js';

vi.mock('../src/lib/prompt.js', () => ({ confirm: vi.fn() }));

let home: string;
let orig: string | undefined;

function seed(id: string, updatedAt: string, bytes = 10): void {
  const db = openDb({ path: join(home, 'sessions.db') });
  try {
    db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
       VALUES (?, ?, ?, 'u', 't', 'o', 1, ?, 'finalized')`,
    ).run(id, updatedAt, updatedAt, bytes);
  } finally {
    db.close();
  }
  mkdirSync(join(home, 'rrweb-events', id), { recursive: true });
  writeFileSync(join(home, 'rrweb-events', id, '0.json.gz'), 'x');
}

async function cap(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const o = vi.spyOn(process.stdout, 'write').mockImplementation(((c: string | Uint8Array) => {
    out += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  }) as typeof process.stdout.write);
  const e = vi.spyOn(process.stderr, 'write').mockImplementation(((c: string | Uint8Array) => {
    err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
    return true;
  }) as typeof process.stderr.write);
  try {
    const code = await runRetention(argv);
    return { code, out, err };
  } finally {
    o.mockRestore();
    e.mockRestore();
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-ret-cli-'));
  orig = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
  mkdirSync(home, { recursive: true });
  vi.mocked(confirm).mockReset();
});
afterEach(() => {
  if (orig === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = orig;
  rmSync(home, { recursive: true, force: true });
});

describe('peek retention', () => {
  it('set writes policy.json and show prints it', async () => {
    expect((await cap(['set', '--max-age', '30d', '--keep', '5'])).code).toBe(0);
    expect(loadPolicy()).toEqual({ maxAge: '30d', keepLast: 5 });
    const shown = await cap(['show']);
    expect(shown.out).toContain('30d');
  });

  it('set --clear removes the policy', async () => {
    await cap(['set', '--keep', '3']);
    await cap(['set', '--clear']);
    expect(loadPolicy()).toBeNull();
  });

  it('preview is non-destructive and lists candidates', async () => {
    seed('old', '2020-01-01T00:00:00.000Z');
    seed('new', new Date().toISOString());
    const res = await cap(['preview', '--max-age', '30d']);
    expect(res.code).toBe(0);
    expect(res.out).toContain('old');
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 2 });
    } finally {
      db.close();
    }
  });

  it('apply --yes deletes candidates', async () => {
    seed('old', '2020-01-01T00:00:00.000Z');
    seed('new', new Date().toISOString());
    const res = await cap(['apply', '--max-age', '30d', '--yes']);
    expect(res.code).toBe(0);
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 1 });
      expect(db.prepare("SELECT COUNT(*) c FROM sessions WHERE id='old'").get()).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('apply refuses when the effective policy is empty', async () => {
    seed('a', new Date().toISOString());
    const res = await cap(['apply', '--yes']);
    expect(res.code).toBe(1);
    expect(res.err).toMatch(/no .*policy|configure/i);
  });

  it('apply (no --yes) deletes nothing when the prompt is declined', async () => {
    seed('old', '2020-01-01T00:00:00.000Z');
    vi.mocked(confirm).mockResolvedValueOnce(false);
    const res = await cap(['apply', '--max-age', '30d']);
    expect(res.code).toBe(0);
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 1 });
    } finally {
      db.close();
    }
  });

  it('apply does not delete a session that became active during the confirm pause', async () => {
    seed('old', '2020-01-01T00:00:00.000Z');
    // While "confirming", a concurrent writer flips the candidate to active.
    vi.mocked(confirm).mockImplementationOnce(async () => {
      const db = openDb({ path: join(home, 'sessions.db') });
      try {
        db.prepare("UPDATE sessions SET status='active' WHERE id='old'").run();
      } finally {
        db.close();
      }
      return true;
    });
    const res = await cap(['apply', '--max-age', '30d']);
    expect(res.code).toBe(0);
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      expect(db.prepare("SELECT COUNT(*) c FROM sessions WHERE id='old'").get()).toEqual({ c: 1 });
    } finally {
      db.close();
    }
  });
});
