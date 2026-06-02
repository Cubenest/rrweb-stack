// Local IPC endpoint path for the MCP-process ↔ native-host bridge (Task 3.24
// IPC layer). The two `peek-mcp` processes share the peek data dir; the
// simplest cross-platform local-only IPC is a Unix domain socket on
// macOS/Linux (`<peekHome>/host.sock`) and a named pipe on Windows.
//
// Item D: the socket lives DIRECTLY inside the peek data dir (peekHomeDir(),
// which honors $PEEK_HOME) as `host.sock`. The native host binds at the same
// `join(peekHomeDir(), 'host.sock')`, so a user who relocates the store via
// PEEK_HOME gets the bridge and the host on ONE path — not the bridge dialing
// ~/.peek/host.sock while the host listens elsewhere.
//
// Pure path derivation — no `node:net`, no filesystem — so it unit-tests
// cleanly. The peek-home dir is injectable for tests.

import { platform } from 'node:os';
import { join } from 'node:path';
import { peekHomeDir } from '../db/open.js';

/**
 * The local socket / named-pipe path the {@link LocalSocketHostBridge} connects
 * to and the {@link HostSocketServer} listens on.
 *
 * @param peekHome the peek data dir (defaults to {@link peekHomeDir}, which
 *   honors `$PEEK_HOME`). On win32 the named pipe is a fixed namespace path and
 *   this argument is ignored.
 */
export function hostSocketPath(peekHome = peekHomeDir()): string {
  // Windows named pipes live in the `\\.\pipe\` namespace, not the filesystem.
  if (platform() === 'win32') return '\\\\.\\pipe\\peek-host';
  return join(peekHome, 'host.sock');
}
