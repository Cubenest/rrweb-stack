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
import { selectPruneCandidates, sumSessionBytes } from './db.js';
import { formatBytes } from './output.js';
import type { RetentionPolicy } from './retention.js';

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

/** Retention accounting (H3.4a): store totals + how much a configured policy would prune. */
export interface RetentionStatus {
  /** SUM(bytes) across all sessions. */
  readonly totalBytes: number;
  /** Number of sessions in the store. */
  readonly sessionCount: number;
  /** Oldest `updated_at` (ISO), or null when the store is empty. */
  readonly oldest: string | null;
  /** Newest `updated_at` (ISO), or null when the store is empty. */
  readonly newest: string | null;
  /** The configured policy, or null when none is set. */
  readonly policy: RetentionPolicy | null;
  /** Sessions the policy would prune now (0 when no policy). */
  readonly overPolicyCount: number;
  /** Bytes the policy would reclaim now (0 when no policy). */
  readonly overPolicyBytes: number;
}

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
  /** Retention accounting; undefined when the DB couldn't be opened. */
  readonly retention?: RetentionStatus;
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
  /** Configured retention policy (from `loadPolicy()`), or null when none. */
  readonly policy?: RetentionPolicy | null;
  /** "Now" for over-policy computation (defaults to `Date.now()`). */
  readonly now?: number;
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
  let retention: RetentionStatus | undefined;
  if (dbExists) {
    const db = probes.openDb();
    if (db) {
      try {
        version = schemaVersion(db);
        sessionCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c;

        // Retention accounting reuses this same handle (no double-open).
        const totalBytes = sumSessionBytes(db);
        const span = db
          .prepare(
            'SELECT MIN(updated_at) AS lo, MAX(updated_at) AS hi, COUNT(*) AS c FROM sessions',
          )
          .get() as { lo: string | null; hi: string | null; c: number };
        const policy = probes.policy ?? null;
        let overPolicyCount = 0;
        let overPolicyBytes = 0;
        if (policy !== null) {
          const cands = selectPruneCandidates(db, policy, probes.now ?? Date.now());
          overPolicyCount = cands.length;
          overPolicyBytes = cands.reduce((sum, c) => sum + c.bytes, 0);
        }
        retention = {
          totalBytes,
          sessionCount: span.c,
          oldest: span.lo,
          newest: span.hi,
          policy,
          overPolicyCount,
          overPolicyBytes,
        };
      } catch {
        // Leave version/sessionCount/retention as-is — a present-but-unreadable
        // DB is still worth reporting (the path + size already are).
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
    // exactOptionalPropertyTypes: only attach `retention` when present.
    ...(retention ? { retention } : {}),
  };
}

/** One-line policy summary for the status render (max-age / max-size / keep-last). */
function describePolicyShort(p: RetentionPolicy): string {
  const parts: string[] = [];
  if (p.maxAge !== undefined) parts.push(`max-age ${p.maxAge}`);
  if (p.maxSizeBytes !== undefined) parts.push(`max-size ${formatBytes(p.maxSizeBytes)}`);
  if (p.keepLast !== undefined) parts.push(`keep-last ${p.keepLast}`);
  return parts.length > 0 ? parts.join(', ') : '(empty)';
}

/** Render a {@link StatusReport} as the human-readable `peek status` output. */
export function renderStatus(report: StatusReport): string {
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

  if (report.retention) {
    const r = report.retention;
    lines.push('Retention:');
    lines.push(`  store:   ${formatBytes(r.totalBytes)} across ${r.sessionCount} session(s)`);
    if (r.oldest && r.newest) lines.push(`  span:    ${r.oldest} → ${r.newest}`);
    if (r.policy) {
      lines.push(`  policy:  ${describePolicyShort(r.policy)}`);
      lines.push(
        `  over policy: ${r.overPolicyCount} session(s), ${formatBytes(r.overPolicyBytes)} (run \`peek retention preview\`)`,
      );
    } else {
      lines.push('  policy:  none — no retention policy set (see `peek retention`)');
    }
    lines.push('');
  }

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
