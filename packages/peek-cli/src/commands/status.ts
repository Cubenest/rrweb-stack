// `peek status` command shell (Task 3.7). Wires the real filesystem/platform
// probes into the pure `gatherStatus`, then prints. Reports native-host
// manifest install state, DB path + size + schema version, and the (best-effort)
// extension connection state.

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { openDb } from '@peekdev/mcp/db';
import {
  type SupportedPlatform,
  loadExtensionIds,
  resolveInstallTargets,
} from '@peekdev/mcp/native-host';
import { defaultDbPath } from '../lib/peek-home.js';
import { loadPolicy } from '../lib/retention.js';
import { gatherStatus, renderStatus } from '../lib/status.js';

const SUPPORTED: readonly SupportedPlatform[] = ['darwin', 'linux', 'win32'];

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

export function runStatus(): number {
  const platform = process.platform;
  if (!SUPPORTED.includes(platform as SupportedPlatform)) {
    process.stdout.write(`peek status: unsupported platform '${platform}'.\n`);
    return 0;
  }

  const home = homedir();
  const dbPath = defaultDbPath();

  let extensionIds: ReturnType<typeof loadExtensionIds>;
  try {
    extensionIds = loadExtensionIds();
  } catch {
    // The published extension-ids.json may be unreadable in a partial install;
    // fall back to placeholders so status still renders the rest.
    extensionIds = { chromeWebStore: '', edgeAddons: '', dev: '' };
  }

  const report = gatherStatus({
    dbPath,
    fileSize,
    fileExists: existsSync,
    manifestTargets: resolveInstallTargets(platform as SupportedPlatform, home),
    extensionIds,
    openDb: () => {
      try {
        return openDb({ path: dbPath, skipMigrations: true });
      } catch {
        return null;
      }
    },
    policy: loadPolicy(),
    now: Date.now(),
  });

  process.stdout.write(`${renderStatus(report)}\n`);
  return 0;
}
