import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync as renameSyncReal,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

// On Windows, renameSync over an existing target throws EBUSY/EPERM/EACCES when
// the target (or freshly-written temp) is held with an exclusive lock — an
// editor with ~/.claude.json open, or aggressive AV scanning the temp. Unlike
// POSIX, where rename always succeeds, this is a transient, retryable condition.
const ebusy = (code: string) => () => {
  throw Object.assign(new Error(`${code}: simulated lock`), { code });
};

describe('atomicWriteFileSync — Windows lock retry', () => {
  it('retries a transient EBUSY on win32 and succeeds', () => {
    const path = join(dir, 'config.json');
    let calls = 0;
    const rename = (from: string, to: string) => {
      calls += 1;
      if (calls < 3) ebusy('EBUSY')();
      renameSyncReal(from, to);
    };
    let sleeps = 0;
    atomicWriteFileSync(path, '{"ok":1}\n', {
      rename,
      platform: 'win32',
      sleep: () => {
        sleeps += 1;
      },
    });
    expect(calls).toBe(3); // failed twice, succeeded on the third
    expect(sleeps).toBe(2); // backed off before each retry
    expect(readFileSync(path, 'utf8')).toBe('{"ok":1}\n');
    expect(readdirSync(dir).filter((f) => f.includes('.peek-tmp-'))).toEqual([]);
  });

  it('rethrows and cleans up the temp file after exhausting retries (win32)', () => {
    const path = join(dir, 'config.json');
    expect(() =>
      atomicWriteFileSync(path, '{"x":1}\n', {
        rename: ebusy('EPERM'),
        platform: 'win32',
        sleep: () => {},
        maxRetries: 3,
      }),
    ).toThrow(/EPERM/);
    expect(readdirSync(dir).filter((f) => f.includes('.peek-tmp-'))).toEqual([]);
  });

  it('does NOT retry on POSIX — a single EBUSY throws immediately', () => {
    const path = join(dir, 'config.json');
    let calls = 0;
    expect(() =>
      atomicWriteFileSync(path, '{"x":1}\n', {
        rename: () => {
          calls += 1;
          ebusy('EBUSY')();
        },
        platform: 'darwin',
        sleep: () => {},
      }),
    ).toThrow(/EBUSY/);
    expect(calls).toBe(1); // no retry on POSIX
  });

  it('does NOT retry a non-transient error code even on win32 (ENOSPC)', () => {
    const path = join(dir, 'config.json');
    let calls = 0;
    expect(() =>
      atomicWriteFileSync(path, '{"x":1}\n', {
        rename: () => {
          calls += 1;
          ebusy('ENOSPC')();
        },
        platform: 'win32',
        sleep: () => {},
      }),
    ).toThrow(/ENOSPC/);
    expect(calls).toBe(1); // disk-full is not a lock — don't retry
  });
});
