/**
 * Per-site consent persistence (ADR-0008 action item #4, P2 PRD §D.1).
 *
 * The set of origins the user has enabled "all tabs on this domain" for is
 * stored in `chrome.storage.sync` so it follows the user across devices. We
 * keep it as a sorted, de-duplicated array of bare origins
 * (`https://example.com`).
 *
 * These helpers take the `chrome.storage.StorageArea` as an argument so they
 * unit-test against `@webext-core/fake-browser` (WXT's bundled fake) without a
 * real browser. `chrome.storage.sync` is the production default.
 */

import { ENABLED_ORIGINS_KEY } from '../constants';
import { originFromUrl } from './origin';

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
 * Carry-in [4] — multi-writer safety. `addEnabledOrigin` / `removeEnabledOrigin`
 * are read-modify-write: read the list, mutate, write it back. The side panel
 * and the SW (which now reacts to navigations) are independent contexts that
 * can run these concurrently; interleaved read→read→write→write loses one
 * update (last write wins, clobbering the other's change).
 *
 * `chrome.storage` exposes no atomic compare-and-set, so we serialize the
 * critical section through a per-area promise chain — an async mutex. Writes to
 * a given area run one-at-a-time, in submission order; reads are not gated
 * (they're naturally consistent against the serialized writes). Keyed per area
 * via a WeakMap so independent test areas don't contend, while the single
 * production `chrome.storage.sync` shares one chain.
 */
const writeChains = new WeakMap<StorageAreaLike, Promise<unknown>>();

function withWriteLock<T>(area: StorageAreaLike, critical: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(area) ?? Promise.resolve();
  // Run `critical` after the previous write settles (success OR failure — a
  // failed write must not wedge the chain). The chain tracks completion only.
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

/** Normalise + de-dupe + sort an arbitrary stored value into a clean origin list. */
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

/** Read the list of origins the user has enabled (sorted, de-duplicated). */
export async function getEnabledOrigins(area: StorageAreaLike = syncArea()): Promise<string[]> {
  const record = await area.get(ENABLED_ORIGINS_KEY);
  return sanitize(record[ENABLED_ORIGINS_KEY]);
}

/**
 * Persist consent for an origin. Idempotent: re-adding an existing origin is a
 * no-op that still resolves. Returns the updated list.
 *
 * @param origin a URL or bare origin; only the origin component is stored.
 */
export async function addEnabledOrigin(
  origin: string,
  area: StorageAreaLike = syncArea(),
): Promise<string[]> {
  const normalized = originFromUrl(origin);
  if (!normalized) {
    throw new Error(`refusing to persist non-http(s) origin: ${origin}`);
  }
  // Serialized read-modify-write (carry-in [4]) so a concurrent writer can't
  // clobber this addition.
  return withWriteLock(area, async () => {
    const current = await getEnabledOrigins(area);
    if (current.includes(normalized)) return current;
    const updated = [...current, normalized].sort();
    await area.set({ [ENABLED_ORIGINS_KEY]: updated });
    return updated;
  });
}

/** Remove consent for an origin (revocation UX, ADR-0008 action item #6). Returns the updated list. */
export async function removeEnabledOrigin(
  origin: string,
  area: StorageAreaLike = syncArea(),
): Promise<string[]> {
  const normalized = originFromUrl(origin);
  if (!normalized) return getEnabledOrigins(area);
  return withWriteLock(area, async () => {
    const current = await getEnabledOrigins(area);
    const updated = current.filter((o) => o !== normalized);
    if (updated.length === current.length) return current;
    await area.set({ [ENABLED_ORIGINS_KEY]: updated });
    return updated;
  });
}

/** Whether the given URL's origin is in the persisted enabled-origins list. */
export async function isOriginEnabled(
  url: string,
  area: StorageAreaLike = syncArea(),
): Promise<boolean> {
  const origin = originFromUrl(url);
  if (!origin) return false;
  const enabled = await getEnabledOrigins(area);
  return enabled.includes(origin);
}
