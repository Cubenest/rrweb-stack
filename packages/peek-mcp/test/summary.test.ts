import type { Database } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { type SessionSummaryRow, getSessionSummaryRow } from '../src/mcp/queries.js';
import { buildSessionSummary } from '../src/mcp/summary.js';

let db: Database;

beforeEach(() => {
  db = openDb({ path: ':memory:' });
});
afterEach(() => {
  db.close();
});

/** Fetch a seeded session row, failing the test (with narrowing) if absent. */
function mustRow(id: string): SessionSummaryRow {
  const row = getSessionSummaryRow(db, id);
  if (!row) throw new Error(`test seed missing session ${id}`);
  return row;
}

function seedSession(opts: { id: string; title?: string; origin?: string; url?: string }): void {
  db.prepare(
    'INSERT INTO sessions (id, created_at, updated_at, url, title, origin) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    opts.id,
    '2026-05-26T00:00:00.000Z',
    '2026-05-26T00:01:00.000Z',
    opts.url ?? null,
    opts.title ?? null,
    opts.origin ?? null,
  );
}

describe('buildSessionSummary', () => {
  it('reports accurate console error counts beyond a 1000-row cap (I3)', () => {
    seedSession({ id: 's_big' });
    const insert = db.prepare(
      'INSERT INTO console_events (session_id, ts_ms, level, message) VALUES (?, ?, ?, ?)',
    );
    const insertMany = db.transaction((n: number) => {
      for (let i = 0; i < n; i += 1) insert.run('s_big', 1000 + i, 'error', `boom ${i}`);
    });
    insertMany(1200); // > 1000

    const summary = buildSessionSummary(db, mustRow('s_big'), []);
    // Was silently capped at 1000 with the old getConsoleErrors(limit:1000).length.
    expect(summary.consoleErrorCount).toBe(1200);
    expect(summary.narrative).toContain('1200 console error(s)');
  });

  it('clips an oversized title/origin in the summary (M2)', () => {
    seedSession({
      id: 's_clip',
      title: 'T'.repeat(500),
      origin: `https://${'a'.repeat(300)}.com`,
    });
    const summary = buildSessionSummary(db, mustRow('s_clip'), []);
    expect(summary.title?.length).toBeLessThan(500);
    expect(summary.title).toContain('… [+');
    expect(summary.origin?.length).toBeLessThan(300);
  });

  it('counts clicks/inputs/navigations from the event stream', () => {
    seedSession({ id: 's_acts', url: 'https://app/start' });
    // No events here — tallies are zero, narrative still coherent.
    const summary = buildSessionSummary(db, mustRow('s_acts'), []);
    expect(summary).toMatchObject({ clicks: 0, inputs: 0, navigations: 0 });
    expect(summary.narrative).toContain('No console or network errors were recorded.');
  });
});
