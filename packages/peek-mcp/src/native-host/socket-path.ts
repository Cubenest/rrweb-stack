// Local IPC endpoint path for the MCP-process ↔ native-host bridge (Task 3.24
// IPC layer). The two `peek-mcp` processes share ~/.peek/; the simplest
// cross-platform local-only IPC is a Unix domain socket on macOS/Linux
// (`~/.peek/host.sock`) and a named pipe on Windows.
//
// Pure path derivation — no `node:net`, no filesystem — so it unit-tests
// cleanly. `homedir()` is injectable for tests.

import { homedir, platform } from 'node:os';
import { join } from 'node:path';

/**
 * The local socket / named-pipe path the {@link LocalSocketHostBridge} connects
 * to and the {@link HostSocketServer} listens on.
 *
 * @param home override the home directory (tests + alternate PEEK_HOME).
 */
export function hostSocketPath(home = homedir()): string {
  // Windows named pipes live in the `\\.\pipe\` namespace, not the filesystem.
  if (platform() === 'win32') return '\\\\.\\pipe\\peek-host';
  return join(home, '.peek', 'host.sock');
}
