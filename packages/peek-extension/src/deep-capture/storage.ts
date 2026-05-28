/**
 * Per-origin Deep capture toggle persistence (Task 3.26, ADR-0010).
 *
 * Deep capture uses `chrome.debugger` to record response bodies. ADR-0010
 * keeps the feature OFF by default (the install card stays clean — the
 * `debugger` permission lives in `optional_permissions`, not the static
 * `permissions` list) and the user enables it per-site from the side panel.
 *
 * Storage shape (sync — follows the user across devices, same posture as
 * `activation/storage.ts`):
 *   `peek:deepCaptureOrigins` → string[]  (sorted, de-duped bare origins)
 *
 * Read/write surface mirrors `activation/storage.ts` exactly so the side-panel
 * code stays parallel + tests reuse the same fake-area patterns. The
 * write-chain mutex (carry-in [4]) keeps a side-panel toggle + a future SW
 * auto-disable from racing on the same key.
 */

import { originFromUrl } from '../activation/origin.js';

/** chrome.storage.sync key holding the per-origin Deep-capture opt-in list. */
export const DEEP_CAPTURE_ORIGINS_KEY = 'peek:deepCaptureOrigins';

/** Subset of `chrome.storage.StorageArea` we depend on. */
export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function syncArea(): StorageAreaLike {
  return chrome.storage.sync as unknown as StorageAreaLike;
}

// Per-area write mutex (see activation/storage.ts for the rationale).
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

function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const origin = originFromUrl(entry);
    if (origin) cleaned.add(origin);
  }
  return [...cleaned].sort();
}

/** Read the full list of origins with Deep capture enabled. */
export async function getDeepCaptureOrigins(area: StorageAreaLike = syncArea()): Promise<string[]> {
  const record = await area.get(DEEP_CAPTURE_ORIGINS_KEY);
  return sanitize(record[DEEP_CAPTURE_ORIGINS_KEY]);
}

/** Whether the given URL's origin has Deep capture enabled. */
export async function isDeepCaptureEnabled(
  url: string,
  area: StorageAreaLike = syncArea(),
): Promise<boolean> {
  const origin = originFromUrl(url);
  if (!origin) return false;
  const enabled = await getDeepCaptureOrigins(area);
  return enabled.includes(origin);
}

/**
 * Persist Deep capture as enabled for an origin. Idempotent; serialized
 * through the write-chain mutex against any concurrent writer.
 *
 * @throws if `originOrUrl` doesn't resolve to an http(s) origin.
 */
export async function enableDeepCapture(
  originOrUrl: string,
  area: StorageAreaLike = syncArea(),
): Promise<string[]> {
  const origin = originFromUrl(originOrUrl);
  if (!origin) {
    throw new Error(`refusing to enable Deep capture for non-http(s) origin: ${originOrUrl}`);
  }
  return withWriteLock(area, async () => {
    const current = await getDeepCaptureOrigins(area);
    if (current.includes(origin)) return current;
    const updated = [...current, origin].sort();
    await area.set({ [DEEP_CAPTURE_ORIGINS_KEY]: updated });
    return updated;
  });
}

/** Remove Deep capture for an origin (the "off" half of the toggle). */
export async function disableDeepCapture(
  originOrUrl: string,
  area: StorageAreaLike = syncArea(),
): Promise<string[]> {
  const origin = originFromUrl(originOrUrl);
  if (!origin) return getDeepCaptureOrigins(area);
  return withWriteLock(area, async () => {
    const current = await getDeepCaptureOrigins(area);
    const updated = current.filter((o) => o !== origin);
    if (updated.length === current.length) return current;
    await area.set({ [DEEP_CAPTURE_ORIGINS_KEY]: updated });
    return updated;
  });
}
