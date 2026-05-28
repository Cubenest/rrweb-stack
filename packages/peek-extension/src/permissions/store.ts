/**
 * Per-origin permission-level persistence (Task 3.22, ADR-0010).
 *
 * The five-level model in {@link ./levels.ts} is a *table*; this module is the
 * *storage* — the per-origin level the SW reads to gate `execute_action` and
 * the side panel reads to display the current selection.
 *
 * Storage shape (sync, follows the user across devices):
 *   `peek:permissionLevels` → Record<origin, PermissionLevel>
 *
 * Concurrency: the side panel and the SW both write here (the side panel when
 * the user picks a level; the SW when YOLO Level 4 auto-expires back to a
 * persistent floor). Reuses the same per-area write-chain mutex pattern as
 * `activation/storage.ts` (carry-in [4]) so a race between the two contexts
 * can't lose updates.
 *
 * Default level: a freshly-enabled site that has no stored entry resolves to
 * {@link DEFAULT_PERMISSION_LEVEL} (1, Read-only) — ADR-0010.
 */

import { originFromUrl } from '../activation/origin.js';
import { DEFAULT_PERMISSION_LEVEL, type PermissionLevel } from './levels.js';

/** chrome.storage.sync key holding the per-origin permission level map. */
export const PERMISSION_LEVELS_KEY = 'peek:permissionLevels';

/** The storage-area shape we depend on (subset of `chrome.storage.StorageArea`). */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function syncArea(): StorageAreaLike {
  // chrome.storage.sync at call time (not module load) so the fake can be
  // installed first in tests and so the SW picks up the real API on wake.
  return chrome.storage.sync as unknown as StorageAreaLike;
}

/**
 * Per-area write mutex (see activation/storage.ts for the rationale). Writes
 * to a given area run sequentially; reads aren't gated.
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

/**
 * Normalise an arbitrary stored value into a clean `Record<origin, level>`.
 * Drops entries whose key isn't a recognizable origin or whose value isn't a
 * 0..4 integer. Never throws.
 */
function sanitize(value: unknown): Record<string, PermissionLevel> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, PermissionLevel> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const origin = originFromUrl(key);
    if (!origin) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 4) continue;
    out[origin] = raw as PermissionLevel;
  }
  return out;
}

/** Read the full per-origin level map (sanitized). */
export async function getPermissionLevels(
  area: StorageAreaLike = syncArea(),
): Promise<Record<string, PermissionLevel>> {
  const record = await area.get(PERMISSION_LEVELS_KEY);
  return sanitize(record[PERMISSION_LEVELS_KEY]);
}

/**
 * Look up the level for a single origin. Returns {@link DEFAULT_PERMISSION_LEVEL}
 * (1, Read-only) when nothing has been explicitly stored for the origin — the
 * ADR-0010 default for a newly-enabled site.
 *
 * @param originOrUrl either a bare origin or a full URL; only the origin is read.
 */
export async function getPermissionLevel(
  originOrUrl: string,
  area: StorageAreaLike = syncArea(),
): Promise<PermissionLevel> {
  const origin = originFromUrl(originOrUrl);
  if (!origin) return DEFAULT_PERMISSION_LEVEL;
  const levels = await getPermissionLevels(area);
  return levels[origin] ?? DEFAULT_PERMISSION_LEVEL;
}

/**
 * Persist the level for an origin. Idempotent: writing the same level is a
 * no-op that still resolves. Returns the updated full map.
 *
 * @throws if `originOrUrl` doesn't parse to an http(s) origin (refuse to
 *   persist nonsense keys that sanitize() would just drop on the next read).
 */
export async function setPermissionLevel(
  originOrUrl: string,
  level: PermissionLevel,
  area: StorageAreaLike = syncArea(),
): Promise<Record<string, PermissionLevel>> {
  const origin = originFromUrl(originOrUrl);
  if (!origin) {
    throw new Error(`refusing to persist permission level for non-http(s) origin: ${originOrUrl}`);
  }
  if (!Number.isInteger(level) || level < 0 || level > 4) {
    throw new Error(`invalid permission level: ${level} (must be 0..4)`);
  }
  return withWriteLock(area, async () => {
    const current = await getPermissionLevels(area);
    if (current[origin] === level) return current;
    const updated = { ...current, [origin]: level };
    await area.set({ [PERMISSION_LEVELS_KEY]: updated });
    return updated;
  });
}

/**
 * Remove the explicit level for an origin (revocation / "forget this site").
 * Subsequent reads fall back to {@link DEFAULT_PERMISSION_LEVEL}. Returns the
 * updated map. No-op + resolve when the origin wasn't stored.
 */
export async function clearPermissionLevel(
  originOrUrl: string,
  area: StorageAreaLike = syncArea(),
): Promise<Record<string, PermissionLevel>> {
  const origin = originFromUrl(originOrUrl);
  if (!origin) return getPermissionLevels(area);
  return withWriteLock(area, async () => {
    const current = await getPermissionLevels(area);
    if (!(origin in current)) return current;
    const updated: Record<string, PermissionLevel> = { ...current };
    delete updated[origin];
    await area.set({ [PERMISSION_LEVELS_KEY]: updated });
    return updated;
  });
}
