// Portable single-session bundle (*.peekbundle): a gzipped tar of three
// UNCOMPRESSED members — manifest.json, session.json, events.json. Integrity is
// a SHA-256 manifest over session.json + events.json (corruption detection; no
// signature — a no-account local-first product holds no keys). H2.1.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, extract } from 'tar';
import { sha256Hex } from './audit-chain.js';

export const BUNDLE_FORMAT_VERSION = 1;

/** Printed on export AND embedded in the manifest so the importer sees it too. */
export const FULLSNAPSHOT_CAVEAT =
  'This bundle contains a masked recording of a browser session. Passwords, ' +
  'auth/cookie headers, and detected PII (cards, SSNs, JWTs, API keys, emails, ' +
  'phones) were redacted at capture. However, the full-page snapshot can still ' +
  'include other on-screen text and non-password field values. Review what was ' +
  'on screen before sharing this file.';

export interface BundleSession {
  session: Record<string, unknown>;
  consoleEvents: Record<string, unknown>[];
  networkEvents: Record<string, unknown>[];
}

export interface BundleManifest {
  formatVersion: number;
  tool: 'peek';
  exportedAt: string;
  originalSessionId: string;
  eventCount: number;
  sha256: { 'session.json': string; 'events.json': string };
  caveat: string;
  _attribution: string;
}

export interface BundlePayload {
  session: Record<string, unknown>;
  consoleEvents: Record<string, unknown>[];
  networkEvents: Record<string, unknown>[];
  events: unknown[];
}

export interface UnpackedBundle {
  manifest: BundleManifest;
  session: BundleSession;
  events: unknown[];
}

const ATTRIBUTION =
  'Exported by peek (https://peek.cubenest.in) — local-first browser-session forensics.';

function serializeSession(s: BundleSession): string {
  return JSON.stringify(
    { session: s.session, consoleEvents: s.consoleEvents, networkEvents: s.networkEvents },
    null,
    2,
  );
}

export function packBundle(outPath: string, payload: BundlePayload): void {
  const sessionJson = serializeSession({
    session: payload.session,
    consoleEvents: payload.consoleEvents,
    networkEvents: payload.networkEvents,
  });
  const eventsJson = JSON.stringify(payload.events);
  const manifest: BundleManifest = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    tool: 'peek',
    exportedAt: new Date().toISOString(),
    originalSessionId: String(payload.session.id ?? ''),
    eventCount: payload.events.length,
    sha256: { 'session.json': sha256Hex(sessionJson), 'events.json': sha256Hex(eventsJson) },
    caveat: FULLSNAPSHOT_CAVEAT,
    _attribution: ATTRIBUTION,
  };
  const tmp = mkdtempSync(join(tmpdir(), 'peek-pack-'));
  try {
    writeFileSync(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(join(tmp, 'session.json'), sessionJson);
    writeFileSync(join(tmp, 'events.json'), eventsJson);
    create({ gzip: true, file: outPath, cwd: tmp, sync: true }, [
      'manifest.json',
      'session.json',
      'events.json',
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function unpackBundle(bundlePath: string): UnpackedBundle {
  const tmp = mkdtempSync(join(tmpdir(), 'peek-unpack-'));
  try {
    extract({ file: bundlePath, cwd: tmp, sync: true });
    const manifest = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf8')) as BundleManifest;
    const session = JSON.parse(readFileSync(join(tmp, 'session.json'), 'utf8')) as BundleSession;
    const events = JSON.parse(readFileSync(join(tmp, 'events.json'), 'utf8')) as unknown[];
    return { manifest, session, events };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function verifyBundle(b: UnpackedBundle): void {
  if (b.manifest.formatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new Error(
      `unsupported bundle formatVersion ${b.manifest.formatVersion} (this peek supports ${BUNDLE_FORMAT_VERSION})`,
    );
  }
  const sessionJson = serializeSession(b.session);
  const eventsJson = JSON.stringify(b.events);
  if (sha256Hex(sessionJson) !== b.manifest.sha256['session.json']) {
    throw new Error('bundle integrity check failed: session.json sha256 mismatch');
  }
  if (sha256Hex(eventsJson) !== b.manifest.sha256['events.json']) {
    throw new Error('bundle integrity check failed: events.json sha256 mismatch');
  }
}
