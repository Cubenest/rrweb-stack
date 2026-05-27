import { EventType } from '@cubenest/rrweb-core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { resolveMode } from '../src/index.js';
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
});

describe('argv dispatch (ADR-0007 dual-role binary)', () => {
  it('selects native-host mode when --native-host is present', () => {
    expect(resolveMode(['--native-host'])).toBe('native-host');
    expect(resolveMode(['foo', '--native-host', 'bar'])).toBe('native-host');
  });

  it('defaults to mcp mode otherwise', () => {
    expect(resolveMode([])).toBe('mcp');
    expect(resolveMode(['--verbose'])).toBe('mcp');
  });
});
