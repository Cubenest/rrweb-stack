import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PERMISSION_LEVEL, type PermissionLevel } from '../../src/permissions/levels';
import {
  PERMISSION_LEVELS_KEY,
  getPermissionLevel,
  setPermissionLevel,
} from '../../src/permissions/store';

export interface PermissionLevelControl {
  level: PermissionLevel;
  loaded: boolean;
  busy: boolean;
  error: string | null;
  set: (next: PermissionLevel) => Promise<void>;
}

/**
 * Shared per-origin permission level for the side panel. Both the status pill
 * and the trust dial read this; writes go through `set` (optimistic + rollback)
 * and the storage.onChanged subscription keeps every consumer in sync — and
 * also reflects the SW's own writes (YOLO Level-4 auto-expiry).
 */
export function usePermissionLevel(origin: string | null): PermissionLevelControl {
  const [level, setLevel] = useState<PermissionLevel>(DEFAULT_PERMISSION_LEVEL);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!origin) {
      setLevel(DEFAULT_PERMISSION_LEVEL);
      setLoaded(true);
      return;
    }
    void getPermissionLevel(origin).then((l) => {
      if (!cancelled) {
        setLevel(l);
        setLoaded(true);
      }
    });
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'sync' || !(PERMISSION_LEVELS_KEY in changes)) return;
      void getPermissionLevel(origin).then((l) => {
        if (!cancelled) setLevel(l);
      });
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [origin]);

  const set = useCallback(
    async (next: PermissionLevel): Promise<void> => {
      if (!origin) return;
      setError(null);
      setBusy(true);
      const prev = level;
      setLevel(next); // optimistic
      try {
        await setPermissionLevel(origin, next);
      } catch (err) {
        setLevel(prev); // rollback on failure
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [origin, level],
  );

  return { level, loaded, busy, error, set };
}
