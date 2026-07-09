import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { openDb } from '@peekdev/mcp/db';
import { unpackBundle, verifyBundle } from '@peekdev/mcp/session-bundle';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSessions } from './sessions.js';

let home: string;
let origHome: string | undefined;

function seed(): void {
  mkdirSync(home, { recursive: true });
  const db = openDb({ path: join(home, 'sessions.db') });
  try {
    db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, event_count, bytes, status, events_blob_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      's_x',
      '2026-06-27T00:00:00.000Z',
      '2026-06-27T00:01:00.000Z',
      'https://app.test',
      'T',
      'https://app.test',
      1,
      50,
      'finalized',
      's_x',
    );
    db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message) VALUES (?, ?, ?, ?)',
    ).run('s_x', 1000, 'error', 'boom');
    db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status) VALUES (?, ?, ?, ?, ?)',
    ).run('s_x', 1001, 'GET', 'https://app.test/x', 500);
    db.prepare(
      'INSERT INTO events_chunks (session_id, seq, start_ts_ms, end_ts_ms, event_count, byte_offset, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('s_x', 0, 1000, 1000, 1, 0, 0, '2026-06-27T00:00:00.000Z');
  } finally {
    db.close();
  }
  const chunkDir = join(home, 'rrweb-events', 's_x');
  mkdirSync(chunkDir, { recursive: true });
  writeFileSync(
    join(chunkDir, '0.json.gz'),
    gzipSync(
      Buffer.from(
        JSON.stringify([{ type: 4, data: { href: 'https://app.test' }, timestamp: 1000 }]),
      ),
    ),
  );
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-cli-bundle-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
  seed();
});
afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

describe('peek sessions export --format bundle', () => {
  it('writes a verifiable *.peekbundle with events + rows + caveat', () => {
    const out = join(home, 's_x.peekbundle');
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = runSessions(['export', 's_x', '--format', 'bundle', '--out', out]);
      expect(code).toBe(0);
      expect(existsSync(out)).toBe(true);
      const stderr = errSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(stderr).toMatch(/on screen before sharing/i);
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
    }
    const b = unpackBundle(out);
    expect(() => verifyBundle(b)).not.toThrow();
    expect(b.manifest.originalSessionId).toBe('s_x');
    expect(b.events).toHaveLength(1);
    expect(b.session.consoleEvents).toHaveLength(1);
    expect(b.session.networkEvents).toHaveLength(1);
  });
});
