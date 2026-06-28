import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import { resolveInstallTargets } from '@peekdev/mcp/native-host';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type StatusProbes, gatherStatus, renderStatus } from '../src/lib/status.js';

let home: string;
let orig: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-status-ret-'));
  orig = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});
afterEach(() => {
  if (orig === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = orig;
  rmSync(home, { recursive: true, force: true });
});

function seed(id: string, updatedAt: string, bytes: number): void {
  const db = openDb({ path: join(home, 'sessions.db') });
  try {
    db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at, url, title, origin, event_count, bytes, status)
       VALUES (?, ?, ?, 'u', 't', 'o', 1, ?, 'finalized')`,
    ).run(id, updatedAt, updatedAt, bytes);
  } finally {
    db.close();
  }
}

describe('status retention accounting', () => {
  it('reports total store bytes and over-policy count when a policy is set', () => {
    seed('old', '2020-01-01T00:00:00.000Z', 100);
    seed('new', new Date().toISOString(), 50);
    const report = gatherStatus(makeProbes({ maxAge: '30d' }));
    expect(report.retention?.totalBytes).toBe(150);
    expect(report.retention?.sessionCount).toBe(2);
    expect(report.retention?.overPolicyCount).toBe(1);
    expect(renderStatus(report)).toContain('over policy');
  });

  it('reports no-policy state', () => {
    seed('a', new Date().toISOString(), 10);
    const report = gatherStatus(makeProbes(null));
    expect(report.retention?.totalBytes).toBe(10);
    expect(renderStatus(report)).toMatch(/no retention policy|policy: {2}none/i);
  });

  // Build a probes object matching the REAL StatusProbes shape (status.ts).
  function makeProbes(
    policy: { maxAge?: string; maxSizeBytes?: number; keepLast?: number } | null,
  ): StatusProbes {
    return {
      dbPath: join(home, 'sessions.db'),
      fileSize: () => 4096,
      fileExists: () => true,
      manifestTargets: resolveInstallTargets('darwin', home),
      extensionIds: { chromeWebStore: '', edgeAddons: '', dev: '' },
      openDb: () => openDb({ path: join(home, 'sessions.db'), skipMigrations: true }),
      policy,
      now: Date.now(),
    };
  }
});
