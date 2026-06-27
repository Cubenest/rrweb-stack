import { readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { openDb } from '@peekdev/mcp/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSessions } from './sessions.js';

let home: string;
let origHome: string | undefined;

function seed(): void {
  mkdirSync(home, { recursive: true });
  const db = openDb({ path: join(home, 'sessions.db') });
  try {
    db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, user_agent, event_count, bytes, status, events_blob_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      's_x',
      '2026-06-27T00:00:00.000Z',
      '2026-06-27T00:01:00.000Z',
      'https://app.test',
      'T',
      'https://app.test',
      'Mozilla/5.0 (peek-test)',
      1,
      50,
      'finalized',
      's_x',
    );
    db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message) VALUES (?, ?, ?, ?)',
    ).run('s_x', 1000, 'error', 'boom');
    db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status, status_text, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('s_x', 1001, 'GET', 'https://app.test/x', 500, 'Internal Server Error', 'req-1');
    // A pending request: NULL status AND NULL error_text. The old triage query
    // (status >= 400 OR error_text IS NOT NULL) would DROP this row on export.
    db.prepare(
      'INSERT INTO network_events (session_id, ts_ms, method, url, status, error_text) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('s_x', 1002, 'GET', 'https://app.test/pending', null, null);
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
  home = mkdtempSync(join(tmpdir(), 'peek-cli-import-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
  seed();
});
afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

describe('peek sessions import', () => {
  it('round-trips: export then import mints a new id with equivalent rows', () => {
    const out = join(home, 's_x.peekbundle');
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(runSessions(['export', 's_x', '--format', 'bundle', '--out', out])).toBe(0);
      expect(runSessions(['import', out])).toBe(0);
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
    }
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      const rows = db.prepare("SELECT id FROM sessions WHERE id != 's_x'").all() as {
        id: string;
      }[];
      expect(rows).toHaveLength(1);
      // noUncheckedIndexedAccess: cast via slice to get a defined element
      const [firstRow] = rows as [{ id: string }, ...{ id: string }[]];
      const newId = firstRow.id;
      expect(db.prepare('SELECT event_count FROM sessions WHERE id = ?').get(newId)).toEqual({
        event_count: 1,
      });
      // Field fidelity: the bundle must carry snake_case rows so the importer
      // preserves created_at / user_agent (would reset/null with camelCase keys).
      expect(
        db.prepare('SELECT created_at, user_agent FROM sessions WHERE id = ?').get(newId),
      ).toEqual({
        created_at: '2026-06-27T00:00:00.000Z',
        user_agent: 'Mozilla/5.0 (peek-test)',
      });
      // Console ts_ms must survive (camelCase `ts` would have landed as 0).
      expect(
        db
          .prepare('SELECT ts_ms, level, message FROM console_events WHERE session_id = ?')
          .get(newId),
      ).toEqual({ ts_ms: 1000, level: 'error', message: 'boom' });
      // Network ts_ms + status_text must survive (camelCase keys would null them).
      expect(
        db
          .prepare(
            'SELECT ts_ms, status, status_text FROM network_events WHERE session_id = ? AND ts_ms = 1001',
          )
          .get(newId),
      ).toEqual({ ts_ms: 1001, status: 500, status_text: 'Internal Server Error' });
      // Full-fidelity export: BOTH network rows must round-trip, including the
      // pending request (NULL status AND NULL error_text) that the old triage
      // query dropped. The request_id column must also survive.
      expect(
        db.prepare('SELECT COUNT(*) c FROM network_events WHERE session_id = ?').get(newId),
      ).toEqual({ c: 2 });
      expect(
        db
          .prepare('SELECT request_id FROM network_events WHERE session_id = ? AND ts_ms = 1001')
          .get(newId),
      ).toEqual({ request_id: 'req-1' });
    } finally {
      db.close();
    }
  });

  it('fails closed (exit 1) on a tampered bundle', () => {
    const out = join(home, 's_x.peekbundle');
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(runSessions(['export', 's_x', '--format', 'bundle', '--out', out])).toBe(0);
      const buf = readFileSync(out);
      // corrupt the gzip — writeUInt8 avoids noUncheckedIndexedAccess on buf[n]
      const midOffset = Math.floor(buf.length / 2);
      buf.writeUInt8((buf.readUInt8(midOffset) ^ 0xff) & 0xff, midOffset);
      writeFileSync(out, buf);
      expect(runSessions(['import', out])).toBe(1);
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
    }
  });

  it('missing file arg exits 1', () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(runSessions(['import'])).toBe(1);
    } finally {
      errSpy.mockRestore();
    }
  });
});
