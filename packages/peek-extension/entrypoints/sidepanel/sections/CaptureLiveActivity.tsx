import { useEffect, useState } from 'react';
import { EMPTY_RECORDER_STATS, type RecorderStats, sendCmd } from '../../../src/messaging/protocol';

const POLL_INTERVAL_MS = 1500;

/** Live capture counters. Polls the SW's per-tab RecorderStats; SW-unavailable
 * degrades to last-known/zero (carry-in [10]) rather than surfacing an error. */
export function CaptureLiveActivity({ tabId }: { tabId: number | undefined }): React.JSX.Element {
  const [stats, setStats] = useState<RecorderStats>(EMPTY_RECORDER_STATS);

  useEffect(() => {
    let cancelled = false;
    if (tabId === undefined) {
      setStats(EMPTY_RECORDER_STATS);
      return;
    }
    const poll = (): void => {
      void sendCmd({ type: 'getRecorderStats', tabId })
        .then((s) => {
          if (!cancelled) setStats(s);
        })
        .catch(() => {
          // SW asleep / handler error — keep last-known counts.
        });
    };
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tabId]);

  return (
    <p className="peek-stats">
      <span>
        <strong>{stats.domMutations}</strong> DOM
      </span>
      <span aria-hidden="true"> · </span>
      <span>
        <strong>{stats.consoleLogs}</strong> console
      </span>
      <span aria-hidden="true"> · </span>
      <span>
        <strong>{stats.networkRequests}</strong> network
      </span>
    </p>
  );
}
