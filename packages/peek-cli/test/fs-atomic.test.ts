import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWriteFileSync } from '../src/lib/fs-atomic.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peek-atomic-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('atomicWriteFileSync', () => {
  it('replaces an existing file with the new content', () => {
    const path = join(dir, 'config.json');
    writeFileSync(path, '{"old":true}\n', 'utf8');
    atomicWriteFileSync(path, '{"new":true}\n');
    expect(readFileSync(path, 'utf8')).toBe('{"new":true}\n');
  });

  it('leaves no temp file behind on success', () => {
    const path = join(dir, 'config.json');
    atomicWriteFileSync(path, '{"a":1}\n');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.peek-tmp-'));
    expect(leftovers).toEqual([]);
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('creates missing parent directories', () => {
    const path = join(dir, 'nested', 'deep', 'config.json');
    atomicWriteFileSync(path, '{"x":1}\n');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('{"x":1}\n');
  });

  it('throws and leaves no temp file when the target dir is unwritable', () => {
    // Point at a path whose parent is a FILE, not a directory → rename/mkdir fails.
    const fileAsDir = join(dir, 'iamfile');
    writeFileSync(fileAsDir, 'x', 'utf8');
    const path = join(fileAsDir, 'config.json');
    expect(() => atomicWriteFileSync(path, '{"y":1}\n')).toThrow();
    // No stray temp file in the real dir.
    const leftovers = readdirSync(dir).filter((f) => f.includes('.peek-tmp-'));
    expect(leftovers).toEqual([]);
  });
});
