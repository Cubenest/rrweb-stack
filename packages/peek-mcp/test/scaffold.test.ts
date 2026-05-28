import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventType } from '@cubenest/rrweb-core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { callingExtensionOrigin, resolveMode } from '../src/index.js';
import { SERVER_NAME, SERVER_VERSION } from '../src/mcp/server.js';
import { loadExtensionIds } from '../src/native-host/config.js';

describe('scaffold: workspace + native deps resolve', () => {
  it('loads better-sqlite3 (native module) under bare-Node ESM', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    const v = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    expect(typeof v.v).toBe('string');
    db.close();
  });

  it('resolves the @cubenest/rrweb-core workspace dependency', () => {
    expect(EventType.FullSnapshot).toBe(2);
    expect(EventType.Plugin).toBe(6);
  });

  it('ships a parseable extension-ids.json with the three id slots', () => {
    const ids = loadExtensionIds();
    expect(ids).toHaveProperty('chromeWebStore');
    expect(ids).toHaveProperty('edgeAddons');
    expect(ids).toHaveProperty('dev');
  });

  // Regression: SERVER_VERSION used to be hardcoded `'0.1.0-alpha.0'` and drifted
  // out of sync when the package bumped to alpha.1. Now read at runtime via
  // createRequire — assert it always matches package.json so a future revert is caught.
  it('SERVER_VERSION matches package.json (no hardcode drift)', () => {
    const pkgPath = join(fileURLToPath(import.meta.url), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string };
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(SERVER_NAME).toBe('peek-mcp');
  });
});

describe('argv dispatch (ADR-0007 dual-role binary)', () => {
  it('selects native-host mode when --native-host is present', () => {
    expect(resolveMode(['--native-host'])).toBe('native-host');
    expect(resolveMode(['foo', '--native-host', 'bar'])).toBe('native-host');
  });

  it('selects native-host mode on the Chrome extension-origin argument', () => {
    // Chrome/Edge spawn the manifest `path` with the calling extension's origin
    // as argv[0] and NO --native-host flag — this is the production path.
    expect(resolveMode(['chrome-extension://abcdefghijklmnop/'])).toBe('native-host');
    // Windows additionally passes the native window handle as a second arg.
    expect(resolveMode(['chrome-extension://abcdefghijklmnop/', '--parent-window=12345'])).toBe(
      'native-host',
    );
  });

  it('defaults to mcp mode otherwise', () => {
    expect(resolveMode([])).toBe('mcp');
    expect(resolveMode(['--verbose'])).toBe('mcp');
  });

  it('extracts the calling extension origin when present', () => {
    expect(callingExtensionOrigin(['chrome-extension://abcdefghijklmnop/'])).toBe(
      'chrome-extension://abcdefghijklmnop/',
    );
    expect(callingExtensionOrigin(['--native-host'])).toBeUndefined();
    expect(callingExtensionOrigin([])).toBeUndefined();
  });
});
