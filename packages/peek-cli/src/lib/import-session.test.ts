import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import { loadSessionEvents } from '@peekdev/mcp/mcp/event-blobs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importSessionBundle } from './import-session.js';

let home: string;
let origHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-import-'));
  origHome = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});
afterEach(() => {
  if (origHome === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const bundle = () => ({
  manifest: {
    formatVersion: 1,
    tool: 'peek' as const,
    exportedAt: 'x',
    originalSessionId: 's_orig',
    eventCount: 1,
    sha256: { 'session.json': '', 'events.json': '' },
    caveat: '',
    _attribution: '',
  },
  session: {
    session: {
      id: 's_orig',
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:01:00.000Z',
      url: 'https://app.test',
      title: 'T',
      origin: 'https://app.test',
      status: 'finalized',
    },
    consoleEvents: [{ session_id: 's_orig', ts_ms: 1000, level: 'error', message: 'boom' }],
    networkEvents: [
      { session_id: 's_orig', ts_ms: 1001, method: 'GET', url: 'https://app.test/x', status: 500 },
    ],
  },
  events: [{ type: 4, data: { href: 'https://app.test' }, timestamp: 1000 }],
});

describe('importSessionBundle', () => {
  it('writes rows + a re-encoded chunk under a fresh id and round-trips events', () => {
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      const newId = importSessionBundle(db, bundle(), { newId: true });
      expect(newId).not.toBe('s_orig');
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(newId) as Record<
        string,
        unknown
      >;
      expect(row.origin).toBe('https://app.test');
      expect(row.event_count).toBe(1);
      expect(
        db.prepare('SELECT COUNT(*) c FROM console_events WHERE session_id = ?').get(newId),
      ).toEqual({ c: 1 });
      expect(
        db.prepare('SELECT COUNT(*) c FROM network_events WHERE session_id = ?').get(newId),
      ).toEqual({ c: 1 });
      expect(
        db.prepare('SELECT COUNT(*) c FROM events_chunks WHERE session_id = ?').get(newId),
      ).toEqual({ c: 1 });
      const events = loadSessionEvents(String(row.events_blob_path), join(home, 'rrweb-events'));
      expect(events).toHaveLength(1);
      expect((events[0] as { timestamp: number }).timestamp).toBe(1000);
    } finally {
      db.close();
    }
  });

  it('keeps the original id with { newId: false } and throws on collision without force', () => {
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      const id1 = importSessionBundle(db, bundle(), { newId: false });
      expect(id1).toBe('s_orig');
      expect(() => importSessionBundle(db, bundle(), { newId: false })).toThrow(
        /exists|collision/i,
      );
      importSessionBundle(db, bundle(), { newId: false, force: true });
      expect(db.prepare("SELECT COUNT(*) c FROM sessions WHERE id = 's_orig'").get()).toEqual({
        c: 1,
      });
      expect(
        db.prepare("SELECT COUNT(*) c FROM console_events WHERE session_id = 's_orig'").get(),
      ).toEqual({ c: 1 });
      expect(
        db.prepare("SELECT COUNT(*) c FROM network_events WHERE session_id = 's_orig'").get(),
      ).toEqual({ c: 1 });
      expect(
        db.prepare("SELECT COUNT(*) c FROM events_chunks WHERE session_id = 's_orig'").get(),
      ).toEqual({ c: 1 });
    } finally {
      db.close();
    }
  });

  it('refuses a malicious kept id with path traversal and writes nothing', () => {
    const db = openDb({ path: join(home, 'sessions.db') });
    try {
      const evil = bundle();
      evil.session.session.id = '../../evil';
      expect(() => importSessionBundle(db, evil, { newId: false })).toThrow(
        /unsafe|traversal|path/i,
      );
      // No session row landed and no blob escaped the rrweb-events dir.
      expect(db.prepare("SELECT COUNT(*) c FROM sessions WHERE id = '../../evil'").get()).toEqual({
        c: 0,
      });
      expect(existsSync(join(home, '..', 'evil'))).toBe(false);
    } finally {
      db.close();
    }
  });
});
