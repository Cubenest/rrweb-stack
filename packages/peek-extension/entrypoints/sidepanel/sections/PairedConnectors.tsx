/**
 * SP4 Task 7: Paired-connectors list ("trust-dial" management surface).
 *
 * Shows the full list of currently paired connectors (name + paired-at time +
 * a Remove button). Removing a connector posts a `revokePairing` message to
 * the background SW, which calls `clearPairedConnector`. After removal the
 * list refreshes: that connector's next act-verification will fail and fall
 * back to the local banner.
 *
 * Data is read via `getPairedConnectors()` on mount and after each removal.
 * The list is kept in local component state; errors surface inline.
 *
 * No closedVerdict / fail-closed pattern is needed — revoke is a user-
 * initiated, fire-and-forget action. If the SW is unavailable the remove
 * button surfaces an error; the SW's storage write will be retried on the next
 * successful message round-trip.
 */

import { useCallback, useEffect, useState } from 'react';
import type { RevokePairingMessage } from '../../../src/messaging/protocol';
import type { PairedConnector } from '../../../src/permissions/pairing-store';
import { getPairedConnectors } from '../../../src/permissions/pairing-store';

/** Format a Unix-epoch-ms timestamp as a human-readable local date + time. */
function formatPairedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Post a revoke message to the background SW. Best-effort; errors returned. */
async function postRevoke(connectorId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const msg: RevokePairingMessage = { type: 'revokePairing', connectorId };
    const response = (await chrome.runtime.sendMessage(msg)) as
      | { ok: boolean; reason?: string }
      | undefined;
    return response ?? { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err ?? 'unknown');
    return { ok: false, reason };
  }
}

interface ConnectorRow {
  id: string;
  entry: PairedConnector;
}

/**
 * Paired-connectors management list.
 *
 * Reads directly from `chrome.storage.local` (via `getPairedConnectors`) on
 * mount and after each removal so the list stays consistent with storage. The
 * component has no side-panel sender guard of its own — the SW enforces
 * `isFromSidePanel` on the incoming `revokePairing` message.
 */
export function PairedConnectors(): React.JSX.Element {
  const [rows, setRows] = useState<ConnectorRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Read the current paired-connector map and update local state. */
  const reload = useCallback((): void => {
    void getPairedConnectors()
      .then((map) => {
        setRows(
          Object.entries(map)
            .map(([id, entry]) => ({ id, entry }))
            .sort((a, b) => b.entry.pairedAtMs - a.entry.pairedAtMs),
        );
        setLoaded(true);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err ?? 'load failed'));
        setLoaded(true);
      });
  }, []);

  // Load on mount.
  useEffect(() => {
    reload();
  }, [reload]);

  const handleRemove = useCallback(
    (connectorId: string): void => {
      void postRevoke(connectorId).then((result) => {
        if (!result.ok) {
          setError(`Remove failed: ${result.reason ?? 'unknown'}`);
          return;
        }
        // Optimistic: remove from local state immediately, then re-read storage
        // so a concurrent change (e.g. a re-pair) is reflected.
        setRows((prev) => prev.filter((r) => r.id !== connectorId));
        reload();
      });
    },
    [reload],
  );

  return (
    <details className="peek-disclosure">
      <summary className="peek-disclosure-summary">Paired connectors</summary>
      <div className="peek-disclosure-body">
        {!loaded ? (
          <p className="peek-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="peek-muted peek-placeholder">No connectors paired yet.</p>
        ) : (
          <ul className="peek-paired-list">
            {rows.map(({ id, entry }) => (
              <li key={id} className="peek-paired-row">
                <span className="peek-paired-name">{entry.clientName}</span>
                <span className="peek-paired-time peek-muted">
                  Paired {formatPairedAt(entry.pairedAtMs)}
                </span>
                <button
                  type="button"
                  className="peek-btn peek-btn-danger peek-paired-remove"
                  onClick={() => handleRemove(id)}
                  aria-label={`Remove paired connector ${entry.clientName}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {error !== null && (
          <p className="peek-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
