import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '@peekdev/mcp/db';
import { resolveInstallTargets } from '@peekdev/mcp/native-host';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type StatusProbes, gatherStatus } from '../src/lib/status.js';

const IDS = { chromeWebStore: '', edgeAddons: '', dev: 'devplaceholderid' };

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function probesFor(dbPath: string, homeDir: string, dbExists: boolean): StatusProbes {
  return {
    dbPath,
    fileSize,
    fileExists: existsSync,
    manifestTargets: resolveInstallTargets('darwin', homeDir),
    extensionIds: IDS,
    openDb: () => (dbExists ? openDb({ path: dbPath }) : null),
  };
}

describe('gatherStatus', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'peek-status-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('reports a missing DB cleanly (fresh install)', () => {
    const dbPath = join(home, '.peek', 'sessions.db');
    const report = gatherStatus(probesFor(dbPath, home, false));
    expect(report.dbExists).toBe(false);
    expect(report.dbBytes).toBe(0);
    expect(report.schemaVersion).toBeNull();
    expect(report.sessionCount).toBeNull();
    expect(report.anyManifestInstalled).toBe(false);
    expect(report.extensionConnection).toBe('unknown');
    expect(report.manifestTargets.length).toBeGreaterThan(0);
  });

  it('reports schema version + session count for a seeded DB', () => {
    const dbPath = join(home, '.peek', 'sessions.db');
    const db = openDb({ path: dbPath });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO sessions (id, created_at, updated_at, origin) VALUES (?, ?, ?, ?)').run(
      's_1',
      now,
      now,
      'https://example.com',
    );
    db.close();

    const report = gatherStatus(probesFor(dbPath, home, true));
    expect(report.dbExists).toBe(true);
    expect(report.dbBytes).toBeGreaterThan(0);
    expect(report.schemaVersion).toBe(2);
    expect(report.sessionCount).toBe(1);
  });

  it('detects an installed manifest at a filesystem target', () => {
    const dbPath = join(home, '.peek', 'sessions.db');
    const targets = resolveInstallTargets('darwin', home);
    const first = targets[0];
    if (!first?.manifestPath) throw new Error('expected a filesystem target');

    // Write a manifest at the first target path.
    mkdirSync(join(first.manifestPath, '..'), { recursive: true });
    writeFileSync(first.manifestPath, '{}', 'utf8');

    const report = gatherStatus(probesFor(dbPath, home, false));
    expect(report.anyManifestInstalled).toBe(true);
    const installedTarget = report.manifestTargets.find((t) => t.location === first.manifestPath);
    expect(installedTarget?.installed).toBe(true);
  });
});
