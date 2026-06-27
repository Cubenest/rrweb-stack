import { useEffect, useState } from 'react';
import { isReconnectStalled } from '../../../src/background/backoff';
import type { NativeHostState } from '../../../src/messaging/protocol';
import { type PermissionLevel, permissionLevelInfo } from '../../../src/permissions/levels';
import {
  PERMISSION_LEVELS_KEY,
  getPermissionLevel,
  setPermissionLevel,
} from '../../../src/permissions/store';
import { useNativeHostState } from '../useNativeHostState';

/** The copy-paste command a fresh user runs to register the native host. */
export const PEEK_INIT_COMMAND = 'npm install -g @peekdev/cli && peek init';

/** True only when the origin's effective level is 4 (Auto) — drives the indicator. */
export function isAutoActive(level: PermissionLevel | null): boolean {
  return level === 4;
}

export type HostTone = 'ok' | 'warn' | 'idle';

export interface HostStateView {
  tone: HostTone;
  label: string;
  /**
   * Show the "run `peek init`" hint. True when the host is unreachable
   * ('disconnected') OR when a 'reconnecting' loop has been failing long enough
   * that the host is almost certainly unregistered (Windows audit bug: without
   * this, a perpetual 'reconnecting' state leaves the hint unreachable).
   */
  showSetupHint: boolean;
}

/**
 * Pure: map the native-host connection state (+ consecutive reconnect attempts)
 * → what the header shows.
 *
 * @param state the native-host connection state from the SW
 * @param reconnectAttempts consecutive failed reconnects since the last connect
 *   (default 0); a high value while 'reconnecting' surfaces the setup hint.
 * @param hasEverConnected whether a connection has ever held this SW session
 *   (default false); distinguishes the FIRST connect ("Connecting…") from a
 *   re-connect after a real connection dropped ("Reconnecting…").
 */
export function describeHostState(
  state: NativeHostState,
  reconnectAttempts = 0,
  hasEverConnected = false,
): HostStateView {
  switch (state) {
    case 'connected':
      return { tone: 'ok', label: 'Connected to peek', showSetupHint: false };
    case 'reconnecting':
      // Before any connection has held, a 'reconnecting' state is really the
      // FIRST connect attempt — show "Connecting…", not the misleading
      // "Reconnecting…" (which implies a connection was lost). A brief reconnect
      // after a real connection is a transient host restart → no hint; a
      // persistent one almost always means the host was never registered →
      // surface the same "run `peek init`" guidance the disconnected state shows.
      return {
        tone: 'warn',
        label: hasEverConnected ? 'Reconnecting…' : 'Connecting…',
        showSetupHint: isReconnectStalled(reconnectAttempts),
      };
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
  const { state: hostState, reconnectAttempts, hasEverConnected } = useNativeHostState();
  const view = describeHostState(hostState, reconnectAttempts, hasEverConnected);
  const [level, setLevel] = useState<PermissionLevel | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  // Track the raw numeric level for this origin: the pill derives its `short`
  // label off it (so pill + dial share one vocabulary) and the auto-active
  // indicator keys off level === 4. Re-read on origin change; the dial's writes
  // go through the shared store, so the storage.onChanged listener below also
  // refreshes this on every level change.
  useEffect(() => {
    let cancelled = false;
    if (!origin) {
      setLevel(null);
      return;
    }
    const refreshLevel = async (): Promise<void> => {
      try {
        const l = await getPermissionLevel(origin);
        if (!cancelled) setLevel(l);
      } catch {
        if (!cancelled) setLevel(null);
      }
    };
    void refreshLevel();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'sync' || !(PERMISSION_LEVELS_KEY in changes)) return;
      void refreshLevel();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [origin]);

  const levelShort = level !== null ? permissionLevelInfo(level).short : null;

  const turnOffAuto = async (): Promise<void> => {
    if (!origin) return;
    setDropError(null);
    try {
      // Drop the persistent level back to Read-only. Effective Level 4 today is
      // persistent-level-4 (YOLO has no production activation), so this fully
      // turns auto off; the storage.onChanged listener above refreshes the view.
      // NOTE: when YOLO session-activation is wired, this must also message the
      // SW to call YoloSessionStore.revoke() (the panel can't call it directly).
      await setPermissionLevel(origin, 1);
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className={`peek-status peek-status-${view.tone}`} aria-label="peek status">
      <div className="peek-status-line">
        <span className="peek-status-dot" aria-hidden="true" />
        <span className="peek-status-label">{view.label}</span>
        {levelShort ? <span className="peek-status-pill">{levelShort.toUpperCase()}</span> : null}
      </div>
      {isAutoActive(level) ? (
        <output className="peek-auto-active">
          <span>⚡ Auto-approve active — turns off when you close this tab (or after 60 min)</span>
          <button
            type="button"
            className="peek-btn peek-btn-danger"
            onClick={() => void turnOffAuto()}
          >
            Turn off now
          </button>
          {dropError ? (
            <span className="peek-error" role="alert">
              Couldn&rsquo;t turn off auto-approve: {dropError}
            </span>
          ) : null}
        </output>
      ) : null}
      {view.showSetupHint ? (
        <div className="peek-setup-nudge">
          <p>
            <strong>Finish setting up peek.</strong> Run this once to connect the local recorder:
          </p>
          <code className="peek-setup-cmd">{PEEK_INIT_COMMAND}</code>
          <button
            type="button"
            className="peek-btn"
            onClick={() => void navigator.clipboard?.writeText(PEEK_INIT_COMMAND)}
          >
            Copy command
          </button>
        </div>
      ) : null}
    </section>
  );
}
