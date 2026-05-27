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
import { formatBytes } from '../lib/output.js';
import { defaultDbPath } from '../lib/peek-home.js';
import { type StatusReport, gatherStatus } from '../lib/status.js';

const SUPPORTED: readonly SupportedPlatform[] = ['darwin', 'linux', 'win32'];

function fileSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function renderStatus(report: StatusReport): string {
  const lines: string[] = [];
  lines.push('peek status');
  lines.push('');

  lines.push('Database (~/.peek/sessions.db):');
  lines.push(`  path:    ${report.dbPath}`);
  if (report.dbExists) {
    lines.push(`  size:    ${formatBytes(report.dbBytes)}`);
    lines.push(`  schema:  v${report.schemaVersion ?? '?'}`);
    lines.push(`  sessions: ${report.sessionCount ?? '?'}`);
  } else {
    lines.push('  size:    (not created yet — record a session to initialize)');
  }
  lines.push('');

  lines.push('Native messaging host:');
  lines.push(`  binary:  ${report.hostBinaryPath}`);
  lines.push(
    report.anyManifestInstalled
      ? '  status:  registered'
      : '  status:  not registered (run `peek init` to register with consent)',
  );
  for (const t of report.manifestTargets) {
    const mark = t.installed ? '✔' : '·';
    lines.push(`    ${mark} ${t.browser}: ${t.location}`);
  }
  lines.push('');

  lines.push('Browser extension:');
  const conn =
    report.extensionConnection === 'unknown'
      ? 'unknown (connection check requires the extension; see https://github.com/Cubenest/rrweb-stack)'
      : report.extensionConnection;
  lines.push(`  connection: ${conn}`);

  return lines.join('\n');
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
  });

  process.stdout.write(`${renderStatus(report)}\n`);
  return 0;
}
