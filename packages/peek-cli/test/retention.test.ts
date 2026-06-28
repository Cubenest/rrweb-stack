import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPolicy, loadPolicy, retentionPolicyPath, savePolicy } from '../src/lib/retention.js';

let home: string;
let orig: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peek-retention-'));
  orig = process.env.PEEK_HOME;
  process.env.PEEK_HOME = home;
});
afterEach(() => {
  if (orig === undefined) Reflect.deleteProperty(process.env, 'PEEK_HOME');
  else process.env.PEEK_HOME = orig;
  rmSync(home, { recursive: true, force: true });
});

describe('retention policy persistence', () => {
  it('round-trips a saved policy', () => {
    savePolicy({ maxAge: '30d', maxSizeBytes: 2147483648, keepLast: 20 });
    expect(loadPolicy()).toEqual({ maxAge: '30d', maxSizeBytes: 2147483648, keepLast: 20 });
  });
  it('returns null when no policy file exists', () => {
    expect(loadPolicy()).toBeNull();
  });
  it('returns null (never throws) on malformed JSON', () => {
    writeFileSync(retentionPolicyPath(), '{ not json', 'utf8');
    expect(loadPolicy()).toBeNull();
  });
  it('returns null on schema-invalid content (negative / wrong types)', () => {
    writeFileSync(retentionPolicyPath(), JSON.stringify({ keepLast: -3 }), 'utf8');
    expect(loadPolicy()).toBeNull();
  });
  it('rejects an invalid policy at save time', () => {
    expect(() => savePolicy({ maxAge: 'soon' } as never)).toThrow();
    expect(() => savePolicy({ maxSizeBytes: -1 } as never)).toThrow();
  });
  it('clear removes the file and is idempotent', () => {
    savePolicy({ keepLast: 5 });
    clearPolicy();
    expect(loadPolicy()).toBeNull();
    expect(() => clearPolicy()).not.toThrow();
  });
});
