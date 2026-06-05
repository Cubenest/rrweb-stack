import { useEffect, useState } from 'react';
import type { NativeHostState } from '../../../src/messaging/protocol';
import { permissionLevelInfo } from '../../../src/permissions/levels';
import { PERMISSION_LEVELS_KEY, getPermissionLevel } from '../../../src/permissions/store';
import { useNativeHostState } from '../useNativeHostState';

export type HostTone = 'ok' | 'warn' | 'idle';

export interface HostStateView {
  tone: HostTone;
  label: string;
  /** Show the "run `peek init`" hint (only when the host is unreachable). */
  showSetupHint: boolean;
}

/** Pure: map the native-host connection state → what the header shows. */
export function describeHostState(state: NativeHostState): HostStateView {
  switch (state) {
    case 'connected':
      return { tone: 'ok', label: 'Connected to peek', showSetupHint: false };
    case 'reconnecting':
      return { tone: 'warn', label: 'Reconnecting…', showSetupHint: false };
    default:
      return { tone: 'idle', label: 'Not connected', showSetupHint: true };
  }
}

/**
 * Status header (side-panel redesign). Layer 1: native-host connection +
 * current-level pill (both from data wired today). The "agent attached" /
 * "last action" layer is deferred — no line is shown for it.
 */
export function StatusHeader({ origin }: { origin: string | null }): React.JSX.Element {
  const hostState = useNativeHostState();
  const view = describeHostState(hostState);
  const [levelShort, setLevelShort] = useState<string | null>(null);

  // The pill mirrors the dial's `short` label so pill + dial share one
  // vocabulary. Re-read on origin change; the dial's writes go through the
  // shared usePermissionLevel hook, which also updates this on storage change.
  useEffect(() => {
    let cancelled = false;
    if (!origin) {
      setLevelShort(null);
      return;
    }
    const refreshLevelShort = async (): Promise<void> => {
      try {
        const level = await getPermissionLevel(origin);
        if (!cancelled) setLevelShort(permissionLevelInfo(level).short);
      } catch {
        if (!cancelled) setLevelShort(null);
      }
    };
    void refreshLevelShort();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'sync' || !(PERMISSION_LEVELS_KEY in changes)) return;
      void refreshLevelShort();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [origin]);

  return (
    <section className={`peek-status peek-status-${view.tone}`} aria-label="peek status">
      <div className="peek-status-line">
        <span className="peek-status-dot" aria-hidden="true" />
        <span className="peek-status-label">{view.label}</span>
        {levelShort ? <span className="peek-status-pill">{levelShort.toUpperCase()}</span> : null}
      </div>
      {view.showSetupHint ? (
        <p className="peek-status-hint peek-muted">
          If you haven&rsquo;t set up peek yet, run <code>peek init</code>.
        </p>
      ) : null}
    </section>
  );
}
