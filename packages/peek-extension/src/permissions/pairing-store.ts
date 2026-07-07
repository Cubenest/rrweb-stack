/**
 * Paired-connector persistence (SP4, connector pairing).
 *
 * Stores the SHA-256 hash of each connector's pairing secret in
 * `chrome.storage.local` — keyed by an opaque connector id. Only the hash is
 * stored; the raw secret never touches storage.
 *
 * Storage shape (local, this device only):
 *   `peek:pairedConnectors` → Record<id, PairedConnector>
 *
 * Concurrency: the service-worker and side-panel may both write (e.g. a pair
 * followed by a revoke racing with a subsequent pair). Reuses the same
 * per-area write-chain mutex pattern from `permissions/store.ts` so a race
 * between the two contexts can't lose updates.
 */

/** chrome.storage.local key holding the paired-connector map. */
export const PAIRED_CONNECTORS_KEY = 'peek:pairedConnectors';

/** A single paired connector entry as persisted to storage. */
export interface PairedConnector {
  /** Human-readable name of the connector client (e.g. "Cursor MCP"). */
  clientName: string;
  /** Lowercase hex SHA-256 of the pairing secret. Never the raw secret. */
  hash: string;
  /** Unix epoch milliseconds when the pairing was established. */
  pairedAtMs: number;
}

/** The storage-area shape we depend on (subset of `chrome.storage.StorageArea`). */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function localArea(): StorageAreaLike {
  // chrome.storage.local at call time (not module load) so the fake can be
  // installed first in tests and so the SW picks up the real API on wake.
  return chrome.storage.local as unknown as StorageAreaLike;
}

/**
 * Per-area write mutex. Writes to a given area run sequentially; reads aren't
 * gated. Mirrors the pattern in `permissions/store.ts` and `activation/storage.ts`.
 */
const writeChains = new WeakMap<StorageAreaLike, Promise<unknown>>();

function withWriteLock<T>(area: StorageAreaLike, critical: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(area) ?? Promise.resolve();
  const next = prev.then(critical, critical);
  writeChains.set(
    area,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Hex-string pattern: only 0-9 and a-f characters. */
const HEX_RE = /^[0-9a-f]+$/;

/**
 * Normalise an arbitrary stored value into a clean `Record<id, PairedConnector>`.
 * Drops entries whose value is missing or has an invalid `clientName` (must be
 * a string), `hash` (must be a hex string), or `pairedAtMs` (must be a number).
 * Never throws.
 */
function sanitize(value: unknown): Record<string, PairedConnector> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, PairedConnector> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.clientName !== 'string') continue;
    if (typeof entry.hash !== 'string' || !HEX_RE.test(entry.hash)) continue;
    if (typeof entry.pairedAtMs !== 'number') continue;
    out[key] = {
      clientName: entry.clientName,
      hash: entry.hash,
      pairedAtMs: entry.pairedAtMs,
    };
  }
  return out;
}

/**
 * Compute the SHA-256 digest of a UTF-8 encoded string and return it as a
 * 64-character lowercase hex string.
 */
export async function sha256Hex(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(secret);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Read the full paired-connector map (sanitized). */
export async function getPairedConnectors(
  area: StorageAreaLike = localArea(),
): Promise<Record<string, PairedConnector>> {
  const record = await area.get(PAIRED_CONNECTORS_KEY);
  return sanitize(record[PAIRED_CONNECTORS_KEY]);
}

/**
 * Persist a paired-connector entry. Overwrites any existing entry for `id`.
 * Returns the updated full map.
 */
export async function putPairedConnector(
  id: string,
  entry: PairedConnector,
  area: StorageAreaLike = localArea(),
): Promise<Record<string, PairedConnector>> {
  return withWriteLock(area, async () => {
    const current = await getPairedConnectors(area);
    const updated = { ...current, [id]: entry };
    await area.set({ [PAIRED_CONNECTORS_KEY]: updated });
    return updated;
  });
}

/**
 * Verify that the given `secret` matches the stored hash for `id`.
 *
 * Returns `true` iff an entry for `id` exists AND its `hash` equals
 * `sha256Hex(secret)`. The comparison is hash-vs-hash (both are fixed-length
 * hex strings), so a length-checked early-exit is included to guard against
 * mismatched-length timing leaks before the character-by-character compare.
 */
export async function verifyConnectorSecret(
  id: string,
  secret: string,
  area: StorageAreaLike = localArea(),
): Promise<boolean> {
  const connectors = await getPairedConnectors(area);
  const stored = connectors[id];
  if (stored === undefined) return false;
  const candidate = await sha256Hex(secret);
  // Both are 64-char hex strings produced by the same algorithm; the length
  // check guards against any future divergence before the char-level scan.
  if (stored.hash.length !== candidate.length) return false;
  let mismatch = 0;
  for (let i = 0; i < stored.hash.length; i++) {
    mismatch |= stored.hash.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Remove the entry for `id` from storage. Returns the updated map. No-op
 * (resolves silently) when `id` was not stored.
 */
export async function clearPairedConnector(
  id: string,
  area: StorageAreaLike = localArea(),
): Promise<Record<string, PairedConnector>> {
  return withWriteLock(area, async () => {
    const current = await getPairedConnectors(area);
    if (!(id in current)) return current;
    const updated: Record<string, PairedConnector> = { ...current };
    delete updated[id];
    await area.set({ [PAIRED_CONNECTORS_KEY]: updated });
    return updated;
  });
}
