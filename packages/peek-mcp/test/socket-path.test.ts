import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { peekHomeDir } from '../src/db/open.js';
import { hostSocketPath } from '../src/native-host/socket-path.js';

// Item D: the MCP-process bridge dials hostSocketPath(); the native host binds
// under peekHomeDir(). Both must resolve to the SAME path, including when the
// user relocates the store via PEEK_HOME — otherwise the host listens on one
// socket and the bridge dials another, and the write-path is silently dead.

const ORIGINAL_PEEK_HOME = process.env.PEEK_HOME;

// peekHomeDir() treats an empty PEEK_HOME as "unset" (it checks
// `override && override.length > 0`), so we use '' rather than `delete`
// (which biome's noDelete rule flags) to represent the unset case — same
// convention as migrate.test.ts.
beforeEach(() => {
  process.env.PEEK_HOME = '';
});
afterEach(() => {
  process.env.PEEK_HOME = ORIGINAL_PEEK_HOME ?? '';
});

describe('hostSocketPath — PEEK_HOME consistency (item D)', () => {
  it.skipIf(process.platform === 'win32')('defaults under ~/.peek when PEEK_HOME is unset', () => {
    expect(hostSocketPath()).toBe(join(homedir(), '.peek', 'host.sock'));
  });

  it.skipIf(process.platform === 'win32')('honors PEEK_HOME', () => {
    process.env.PEEK_HOME = '/tmp/peek-custom-home';
    expect(hostSocketPath()).toBe('/tmp/peek-custom-home/host.sock');
  });

  it.skipIf(process.platform === 'win32')(
    'the bridge default equals the host bind path under a custom PEEK_HOME',
    () => {
      process.env.PEEK_HOME = '/tmp/peek-custom-home';
      // The host binds at join(peekHomeDir(), 'host.sock') (see host.ts).
      const hostBindPath = join(peekHomeDir(), 'host.sock');
      // The bridge dials hostSocketPath() with no args.
      expect(hostSocketPath()).toBe(hostBindPath);
    },
  );

  it.skipIf(process.platform !== 'win32')('uses the fixed named pipe on win32', () => {
    process.env.PEEK_HOME = 'C:/whatever';
    expect(hostSocketPath()).toBe('\\\\.\\pipe\\peek-host');
  });
});
