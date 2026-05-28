// Native-host ingest handlers (Task #44 — capture-loop closure).
//
// These tests drive the four message types the SW already sends today:
//   session.append   → events_chunks + gzipped blob on disk + sessions upsert
//   console.append   → console_events rows (batched in a tx)
//   network.append   → network_events rows (batched in a tx)
//   shadow.report    → logged but acknowledged (deferred persistence)
//
// Every test uses an in-memory SQLite + a tmp PEEK_HOME for the blob storage so
// the suite stays hermetic (no ~/.peek pollution).

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { type IngestContext, ingest, rrwebEventsDir } from '../src/native-host/ingest.js';

let db: Database;
let tmpHome: string;
let ctx: IngestContext;
const savedHome = process.env.PEEK_HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peek-ingest-'));
  process.env.PEEK_HOME = tmpHome;
  db = openDb({ path: ':memory:' });
  ctx = { db, home: tmpHome };
});

afterEach(() => {
  db.close();
  rmSync(tmpHome, { recursive: true, force: true });
  if (savedHome === undefined) process.env.PEEK_HOME = '';
  else process.env.PEEK_HOME = savedHome;
});

describe('rrwebEventsDir', () => {
  it('points under PEEK_HOME/rrweb-events', () => {
    expect(rrwebEventsDir(tmpHome)).toBe(join(tmpHome, 'rrweb-events'));
  });
});

describe('session.append — chunk storage + sessions upsert', () => {
  it('writes a gzipped chunk file under PEEK_HOME/rrweb-events/<sessionId>/<seq>.json.gz', () => {
    const reply = ingest(
      {
        type: 'session.append',
        sessionId: 's_one',
        url: 'https://example.com/page',
        title: 'Example',
        events: [
          { type: 4, data: { href: 'https://example.com/' }, timestamp: 1000 },
          { type: 2, data: {}, timestamp: 1500 },
        ],
      },
      ctx,
    );

    expect(reply).toMatchObject({ type: 'session.append.ok', sessionId: 's_one', seq: 0 });
    const dir = join(tmpHome, 'rrweb-events', 's_one');
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files).toEqual(['0.json.gz']);

    const decoded = JSON.parse(gunzipSync(readFileSync(join(dir, '0.json.gz'))).toString('utf8'));
    expect(decoded).toEqual([
      { type: 4, data: { href: 'https://example.com/' }, timestamp: 1000 },
      { type: 2, data: {}, timestamp: 1500 },
    ]);
  });

  it('records a row in events_chunks pointing at the relative blob path', () => {
    ingest(
      {
        type: 'session.append',
        sessionId: 's_chunkrow',
        events: [{ type: 0, data: {}, timestamp: 50 }],
      },
      ctx,
    );
    const row = db
      .prepare('SELECT session_id, seq, start_ts_ms, end_ts_ms, event_count FROM events_chunks')
      .get() as {
      session_id: string;
      seq: number;
      start_ts_ms: number;
      end_ts_ms: number;
      event_count: number;
    };
    expect(row).toEqual({
      session_id: 's_chunkrow',
      seq: 0,
      start_ts_ms: 50,
      end_ts_ms: 50,
      event_count: 1,
    });
  });

  it('upserts the sessions row on first-seen session id', () => {
    ingest(
      {
        type: 'session.append',
        sessionId: 's_upsert',
        url: 'https://acme.test/',
        title: 'Acme',
        events: [{ type: 0, data: {}, timestamp: 100 }],
      },
      ctx,
    );
    const row = db.prepare('SELECT id, url, title, origin FROM sessions').get() as {
      id: string;
      url: string;
      title: string;
      origin: string;
    };
    expect(row.id).toBe('s_upsert');
    expect(row.url).toBe('https://acme.test/');
    expect(row.title).toBe('Acme');
    expect(row.origin).toBe('https://acme.test');
  });

  it('advances seq across multiple appends and keeps both chunks on disk', () => {
    ingest(
      {
        type: 'session.append',
        sessionId: 's_seq',
        events: [{ type: 0, data: {}, timestamp: 10 }],
      },
      ctx,
    );
    const r2 = ingest(
      {
        type: 'session.append',
        sessionId: 's_seq',
        events: [{ type: 0, data: {}, timestamp: 20 }],
      },
      ctx,
    );
    expect(r2).toMatchObject({ type: 'session.append.ok', seq: 1 });

    const dir = join(tmpHome, 'rrweb-events', 's_seq');
    expect(readdirSync(dir).sort()).toEqual(['0.json.gz', '1.json.gz']);

    const rows = db
      .prepare('SELECT seq FROM events_chunks WHERE session_id = ? ORDER BY seq')
      .all('s_seq') as Array<{ seq: number }>;
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
  });

  it('updates the sessions row last_seen across appends (updated_at moves forward)', () => {
    ingest(
      {
        type: 'session.append',
        sessionId: 's_update',
        url: 'https://a.test/',
        events: [{ type: 0, data: {}, timestamp: 100 }],
      },
      ctx,
    );
    const first = db
      .prepare('SELECT updated_at, event_count, bytes FROM sessions WHERE id = ?')
      .get('s_update') as { updated_at: string; event_count: number; bytes: number };

    // Force a wall-clock tick so the ISO timestamps differ even on fast hardware.
    const before = first.updated_at;
    // Replace updated_at backward to verify the upsert moved it forward.
    db.prepare("UPDATE sessions SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(
      's_update',
    );

    ingest(
      {
        type: 'session.append',
        sessionId: 's_update',
        events: [{ type: 0, data: {}, timestamp: 200 }],
      },
      ctx,
    );
    const second = db
      .prepare('SELECT updated_at, event_count, bytes FROM sessions WHERE id = ?')
      .get('s_update') as { updated_at: string; event_count: number; bytes: number };
    expect(second.updated_at >= before).toBe(true);
    expect(second.updated_at).not.toBe('2000-01-01T00:00:00.000Z');
    expect(second.event_count).toBe(2); // accumulator across appends
    expect(second.bytes).toBeGreaterThan(first.bytes);
  });

  it('is idempotent for a duplicate (sessionId, seq) — the retry does not crash or double-count', () => {
    const first = ingest(
      {
        type: 'session.append',
        sessionId: 's_dup',
        events: [{ type: 0, data: {}, timestamp: 1 }],
      },
      ctx,
    );
    expect(first).toMatchObject({ type: 'session.append.ok', seq: 0 });

    // Simulate a retry of the same seq (the SW does seq-based retries).
    const replay = ingest(
      {
        type: 'session.append',
        sessionId: 's_dup',
        seq: 0,
        events: [{ type: 0, data: {}, timestamp: 1 }],
      },
      ctx,
    );
    expect(replay).toMatchObject({ type: 'session.append.ok', seq: 0 });
    // Only one chunk row should exist.
    const rows = db
      .prepare('SELECT COUNT(*) AS c FROM events_chunks WHERE session_id = ?')
      .get('s_dup') as { c: number };
    expect(rows.c).toBe(1);
  });

  it('rejects an empty events array with a structured error reply', () => {
    const reply = ingest({ type: 'session.append', sessionId: 's_empty', events: [] }, ctx);
    expect(reply).toMatchObject({ type: 'session.append.err' });
  });

  it('replies err when sessionId is missing without crashing', () => {
    const reply = ingest(
      // biome-ignore lint/suspicious/noExplicitAny: testing a malformed message
      { type: 'session.append', events: [{ type: 0, data: {}, timestamp: 1 }] } as any,
      ctx,
    );
    expect((reply as { type: string }).type).toBe('session.append.err');
  });
});

describe('console.append — row-per-event into console_events', () => {
  it('inserts each event with session_id, ts_ms, level, message', () => {
    const reply = ingest(
      {
        type: 'console.append',
        sessionId: 's_console',
        url: 'https://x.test/',
        events: [
          { ts: 1000, level: 'info', args: ['hello'] },
          { ts: 1100, level: 'error', args: ['boom', 'at line 5'] },
        ],
      },
      ctx,
    );
    expect(reply).toMatchObject({ type: 'console.append.ok', sessionId: 's_console', count: 2 });

    const rows = db
      .prepare('SELECT session_id, ts_ms, level, message FROM console_events ORDER BY ts_ms')
      .all() as Array<{ session_id: string; ts_ms: number; level: string; message: string }>;
    expect(rows).toEqual([
      { session_id: 's_console', ts_ms: 1000, level: 'info', message: 'hello' },
      { session_id: 's_console', ts_ms: 1100, level: 'error', message: 'boom at line 5' },
    ]);
  });

  it('upserts the parent session row so the FK insert succeeds', () => {
    ingest(
      {
        type: 'console.append',
        sessionId: 's_first',
        events: [{ ts: 1, level: 'log', args: ['x'] }],
      },
      ctx,
    );
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get('s_first') as {
      id: string;
    };
    expect(session.id).toBe('s_first');
  });

  it('replies ok with count=0 for an empty batch (no-op)', () => {
    const reply = ingest({ type: 'console.append', sessionId: 's_empty', events: [] }, ctx);
    expect(reply).toMatchObject({ type: 'console.append.ok', count: 0 });
    expect((db.prepare('SELECT COUNT(*) AS c FROM console_events').get() as { c: number }).c).toBe(
      0,
    );
  });
});

describe('network.append — row-per-record into network_events', () => {
  it('inserts request/response pairs and links the response back via request_id', () => {
    ingest(
      {
        type: 'network.append',
        sessionId: 's_net',
        records: [
          {
            kind: 'request',
            id: 'r1',
            ts: 1000,
            method: 'POST',
            url: 'https://api.test/v1/things',
          },
          { kind: 'response', id: 'r1', ts: 1200, status: 200 },
        ],
      },
      ctx,
    );

    const rows = db
      .prepare(
        'SELECT request_id, method, url, status, duration_ms FROM network_events ORDER BY ts_ms',
      )
      .all() as Array<{
      request_id: string;
      method: string;
      url: string;
      status: number | null;
      duration_ms: number | null;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      request_id: 'r1',
      method: 'POST',
      url: 'https://api.test/v1/things',
    });
    expect(rows[1]?.status).toBe(200);
  });

  it('records an error record with its error_text', () => {
    ingest(
      {
        type: 'network.append',
        sessionId: 's_err',
        records: [
          {
            kind: 'error',
            id: 'r2',
            ts: 2000,
            url: 'https://api.test/v1/fail',
            error: 'NetworkError: failed',
          },
        ],
      },
      ctx,
    );
    const row = db.prepare('SELECT error_text, request_id FROM network_events').get() as {
      error_text: string;
      request_id: string;
    };
    expect(row).toEqual({ error_text: 'NetworkError: failed', request_id: 'r2' });
  });

  it('replies ok with count for a multi-record batch', () => {
    const reply = ingest(
      {
        type: 'network.append',
        sessionId: 's_count',
        records: [
          { kind: 'request', id: 'a', ts: 1, method: 'GET', url: 'https://a/' },
          { kind: 'request', id: 'b', ts: 2, method: 'GET', url: 'https://b/' },
          { kind: 'request', id: 'c', ts: 3, method: 'GET', url: 'https://c/' },
        ],
      },
      ctx,
    );
    expect(reply).toMatchObject({ type: 'network.append.ok', count: 3 });
  });

  // Deep capture body persistence — ADR-0010, PRD §A.8.
  // The relay's `maskNetMessage` runs `redactBody` BEFORE these records leave
  // the content script, so the strings arriving here are already the masked
  // form. These tests cover the host-side persistence half of that path.
  it('persists a masked responseBody on a response record (Deep capture)', () => {
    ingest(
      {
        type: 'network.append',
        sessionId: 's_resp_body',
        records: [
          {
            kind: 'response',
            id: 'rb1',
            ts: 1500,
            status: 200,
            url: 'https://api.test/v1/things/42',
            responseBody: '<<masked>>',
          },
        ],
      },
      ctx,
    );
    const row = db
      .prepare(
        'SELECT request_id, status, request_body_redacted, response_body_redacted FROM network_events WHERE session_id = ?',
      )
      .get('s_resp_body') as {
      request_id: string;
      status: number;
      request_body_redacted: string | null;
      response_body_redacted: string | null;
    };
    expect(row.request_id).toBe('rb1');
    expect(row.status).toBe(200);
    expect(row.response_body_redacted).toBe('<<masked>>');
    expect(row.request_body_redacted).toBeNull();
  });

  it('persists a masked requestBody on a request record (Deep capture)', () => {
    ingest(
      {
        type: 'network.append',
        sessionId: 's_req_body',
        records: [
          {
            kind: 'request',
            id: 'rb2',
            ts: 1700,
            method: 'POST',
            url: 'https://api.test/v1/login',
            requestBody: '<masked body>',
          },
        ],
      },
      ctx,
    );
    const row = db
      .prepare(
        'SELECT request_id, method, request_body_redacted, response_body_redacted FROM network_events WHERE session_id = ?',
      )
      .get('s_req_body') as {
      request_id: string;
      method: string;
      request_body_redacted: string | null;
      response_body_redacted: string | null;
    };
    expect(row.request_id).toBe('rb2');
    expect(row.method).toBe('POST');
    expect(row.request_body_redacted).toBe('<masked body>');
    expect(row.response_body_redacted).toBeNull();
  });

  it('lands SQL NULL (not "undefined" / empty string) when body fields are absent', () => {
    ingest(
      {
        type: 'network.append',
        sessionId: 's_no_body',
        records: [
          {
            kind: 'request',
            id: 'rb3',
            ts: 1900,
            method: 'GET',
            url: 'https://api.test/v1/health',
          },
        ],
      },
      ctx,
    );
    const row = db
      .prepare(
        'SELECT request_body_redacted, response_body_redacted FROM network_events WHERE session_id = ?',
      )
      .get('s_no_body') as {
      request_body_redacted: string | null;
      response_body_redacted: string | null;
    };
    // better-sqlite3 surfaces SQL NULL as JS null; assert explicitly so a
    // future regression that binds `undefined`/`'undefined'`/`''` fails loudly.
    expect(row.request_body_redacted).toBeNull();
    expect(row.response_body_redacted).toBeNull();
  });
});

describe('shadow.report — deferred persistence (log + ack)', () => {
  it('returns a structured ok reply without writing any session/event rows', () => {
    const reply = ingest(
      {
        type: 'shadow.report',
        sessionId: 's_shadow',
        reports: [{ hostPath: 'body > .widget', source: 'chrome.dom', mode: 'closed' }],
      },
      ctx,
    );
    expect(reply).toMatchObject({ type: 'shadow.report.ok' });
    // The shape is reconnaissance-only — no persistence yet (Phase 4 decides).
    expect((db.prepare('SELECT COUNT(*) AS c FROM events_chunks').get() as { c: number }).c).toBe(
      0,
    );
  });
});

describe('error envelopes never crash the host', () => {
  it('returns a structured error reply for an unknown type', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing the unknown-type branch
    const reply = ingest({ type: 'unknown.xyz' } as any, ctx);
    expect((reply as { type: string }).type).toMatch(/\.err$/);
  });

  it('does NOT throw for a malformed shape (missing sessionId)', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing malformed input
      ingest({ type: 'console.append', events: [] } as any, ctx),
    ).not.toThrow();
  });
});
