// `peek status` data-gathering (ADR-0007 action item 6 / P2 PRD §C.1): native
// host manifest install state, SQLite DB path + size + schema version, and
// extension connection state. The gathering is factored into a pure function
// over injected probes (filesystem stat/exists, platform, home dir) so it can be
// tested against a temp PEEK_HOME with a seeded DB without touching the real OS
// or browser dirs. The command shell wires the real probes + prints.

import { schemaVersion } from '@peekdev/mcp/db';
import {
  type ExtensionIds,
  type InstallTarget,
  buildManifest,
  hostBinaryPath,
} from '@peekdev/mcp/native-host';
import type { Database } from 'better-sqlite3';

/** Manifest install state for one browser target. */
export interface ManifestTargetStatus {
  readonly browser: string;
  /** Filesystem path (darwin/linux) or registry key (win32). */
  readonly location: string;
  /** True when the manifest is present at the location. */
  readonly installed: boolean;
}

/** Extension connection state — best-effort; "unknown" until a loopback exists (pre-3d). */
export type ExtensionConnectionState = 'connected' | 'disconnected' | 'unknown';

/** Everything `peek status` reports. */
export interface StatusReport {
  readonly dbPath: string;
  /** True if the DB file exists on disk. */
  readonly dbExists: boolean;
  /** On-disk size in bytes (0 if absent). */
  readonly dbBytes: number;
  /** Highest applied migration, or 0 (or null if the DB couldn't be opened). */
  readonly schemaVersion: number | null;
  readonly sessionCount: number | null;
  readonly hostBinaryPath: string;
  readonly manifestTargets: ManifestTargetStatus[];
  /** True if at least one browser has the manifest installed. */
  readonly anyManifestInstalled: boolean;
  readonly extensionConnection: ExtensionConnectionState;
}

/** Injected probes so status-gathering stays pure + testable. */
export interface StatusProbes {
  /** Absolute DB path (defaults via @peekdev/mcp/db `defaultDbPath`). */
  readonly dbPath: string;
  /** stat → byte size, or null if the path doesn't exist. */
  readonly fileSize: (path: string) => number | null;
  /** True if a manifest path / file exists. */
  readonly fileExists: (path: string) => boolean;
  /** Install targets for the current platform (from `resolveInstallTargets`). */
  readonly manifestTargets: readonly InstallTarget[];
  /** Configured extension IDs (drives the manifest preview). */
  readonly extensionIds: ExtensionIds;
  /**
   * Open the DB read-only for schema/session counts, or null if it can't be
   * opened (absent / locked / corrupt). The caller owns closing it.
   */
  readonly openDb: () => Database | null;
}

function targetLocation(t: InstallTarget): string {
  return t.manifestPath ?? t.registryKey ?? '(unknown target)';
}

/**
 * Gather the status report from the injected probes. Never throws on a missing
 * DB or unreadable manifest dir — those become `false`/`null`/`0` fields so
 * `peek status` can render a clean partial picture (e.g. fresh install with no
 * DB yet, native host not registered).
 */
export function gatherStatus(probes: StatusProbes): StatusReport {
  const dbBytes = probes.fileSize(probes.dbPath);
  const dbExists = dbBytes !== null;

  let version: number | null = null;
  let sessionCount: number | null = null;
  if (dbExists) {
    const db = probes.openDb();
    if (db) {
      try {
        version = schemaVersion(db);
        sessionCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;
      } catch {
        // Leave version/sessionCount null — a present-but-unreadable DB is still
        // worth reporting (the path + size already are).
      } finally {
        db.close();
      }
    }
  }

  const manifest = buildManifest(hostBinaryPath(), probes.extensionIds);
  const manifestTargets: ManifestTargetStatus[] = probes.manifestTargets.map((t) => {
    const location = targetLocation(t);
    // Only filesystem targets can be probed for existence here; registry
    // targets (win32) report `installed:false` until the Windows path lands
    // (Phase 3d) — consistent with the installer's deferred registry write.
    const installed = t.manifestPath !== undefined ? probes.fileExists(t.manifestPath) : false;
    return { browser: t.browser, location, installed };
  });

  return {
    dbPath: probes.dbPath,
    dbExists,
    dbBytes: dbBytes ?? 0,
    schemaVersion: version,
    sessionCount,
    hostBinaryPath: manifest.path,
    manifestTargets,
    anyManifestInstalled: manifestTargets.some((t) => t.installed),
    // A real loopback/health check needs the extension's native port, which
    // isn't wired until Phase 3d. Report "unknown" cleanly rather than fake it.
    extensionConnection: 'unknown',
  };
}
