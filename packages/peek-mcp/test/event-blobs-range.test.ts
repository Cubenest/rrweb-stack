import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compress } from '@cubenest/rrweb-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/open.js';
import { loadEventsUpToTs, loadSessionEvents } from '../src/mcp/event-blobs.js';
import { reconstructDomAt } from '../src/mcp/event-walker.js';
import { documentWith, el, freshIds, fullSnapshot, mutationEvent, text } from './fixtures/rrweb.js';

// Track every path passed to fs.readFileSync so the skip test can assert that
// the range loader decompresses ONLY the chunks it needs. The implementation
// imports readFileSync as a named binding, so a namespace spyOn can't redefine
// the (non-configurable) ESM export and wouldn't intercept the captured binding
// anyway — vi.mock is hoisted ahead of the implementation's import, so its
// pass-through wrapper IS the binding decodeOne actually calls.
const readPaths: string[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      readPaths.push(String(args[0]));
      return actual.readFileSync(...args);
    },
  };
});

let home: string;
let orig: string | undefined;
let db: ReturnType<typeof openDb>;

function ensureSession(sid: string): void {
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)').run(
    sid,
    now,
    now,
  );
}

function writeChunk(sid: string, seq: number, events: { timestamp: number }[]): void {
  ensureSession(sid); // events_chunks.session_id has a FK to sessions(id)
  const dir = join(home, 'rrweb-events', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${seq}.json.gz`), compress(events as never));
  const ts = events.map((e) => e.timestamp);
  db.prepare(
    `INSERT INTO events_chunks (session_id, seq, start_ts_ms, end_ts_ms, event_count, byte_offset, byte_length, created_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(sid, seq, Math.min(...ts), Math.max(...ts), events.length, new Date().toISOString());
}

function snap3(events: { timestamp: number }[] | undefined, ts: number) {
  const s = reconstructDomAt((events ?? []) as never, ts);
  return s
    ? { baseSnapshotTs: s.baseSnapshotTs, mutationsApplied: s.mutationsApplied, html: s.html }
    : undefined;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-range-'));
  orig = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
  db = openDb({ path: join(home, 'sessions.db') });
});
afterEach(() => {
  db.close();
  if (orig === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = orig;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('loadEventsUpToTs', () => {
  it('range-load reconstruction equals whole-load for various ts (byte-identical)', () => {
    const sid = 's_range';
    const eventsDir = join(home, 'rrweb-events');
    // freshIds() -> text('A')=id1, h1=id2, body=id3, html=id4, doc=id5. Mutations
    // carry a real attribute change on the h1 (id2) so reconstruction differs across ts.
    freshIds();
    writeChunk(sid, 0, [fullSnapshot(documentWith([el('h1', { children: [text('A')] })]), 100)]);
    writeChunk(sid, 1, [
      mutationEvent({ attributes: [{ id: 2, attributes: { 'data-step': '1' } }] }, 200),
    ]);
    freshIds();
    // Second FullSnapshot (new tree "B") at t300, then a mutation at t400.
    writeChunk(sid, 2, [
      fullSnapshot(documentWith([el('h1', { children: [text('B')] })]), 300),
      mutationEvent({ attributes: [{ id: 2, attributes: { 'data-step': '2' } }] }, 400),
    ]);
    writeChunk(sid, 3, [
      mutationEvent({ attributes: [{ id: 2, attributes: { 'data-step': '3' } }] }, 500),
    ]);

    const whole = loadSessionEvents(sid, eventsDir);
    for (const ts of [150, 250, 300, 350, 450, 999]) {
      const ranged = loadEventsUpToTs(db, sid, sid, ts, eventsDir);
      expect(snap3(ranged, ts)).toEqual(snap3(whole, ts));
    }
  });

  it('skips chunks: reads fewer .gz files for a ts near the start of a many-chunk session', () => {
    const sid = 's_skip';
    const eventsDir = join(home, 'rrweb-events');
    freshIds();
    writeChunk(sid, 0, [fullSnapshot(documentWith([el('h1', { children: [text('A')] })]), 100)]);
    for (let seq = 1; seq <= 8; seq += 1) {
      writeChunk(sid, seq, [
        mutationEvent(
          { attributes: [{ id: 2, attributes: { 'data-step': String(seq) } }] },
          100 + seq * 100,
        ),
      ]);
    }
    readPaths.length = 0;
    loadEventsUpToTs(db, sid, sid, 250, eventsDir);
    const gzReads = readPaths.filter((p) => p.endsWith('.json.gz')).length;
    expect(gzReads).toBeLessThan(9);
  });

  it('falls back to whole-load when there is no events_chunks index', () => {
    const sid = 's_nochunks';
    const eventsDir = join(home, 'rrweb-events');
    freshIds();
    const dir = join(eventsDir, sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '0.json.gz'),
      compress([fullSnapshot(documentWith([el('h1', { children: [text('A')] })]), 100)] as never),
    );
    expect(snap3(loadEventsUpToTs(db, sid, sid, 999, eventsDir), 999)).toEqual(
      snap3(loadSessionEvents(sid, eventsDir), 999),
    );
  });

  it('returns [] for null blobPath and for a ts before the first chunk', () => {
    const eventsDir = join(home, 'rrweb-events');
    expect(loadEventsUpToTs(db, 'x', null, 100, eventsDir)).toEqual([]);
    const sid = 's_early';
    freshIds();
    writeChunk(sid, 0, [fullSnapshot(documentWith([el('h1', { children: [text('A')] })]), 500)]);
    expect(loadEventsUpToTs(db, sid, sid, 100, eventsDir)).toEqual([]);
  });
});
