import { useEffect, useState } from 'react';
import { EMPTY_RECORDER_STATS, type RecorderStats, sendCmd } from '../../../src/messaging/protocol';

/**
 * Live event-count display (P2 PRD §D.3): "127 DOM mutations · 14 console logs
 * · 9 network reqs".
 *
 * Polls the SW's per-tab RecorderStats (wired in 3d-2). The SW folds each
 * ISOLATED-relay batch into the tab's totals; we re-query on a short interval
 * so the numbers move while the user watches. If the SW is asleep, sendCmd
 * throws ServiceWorkerUnavailableError (carry-in [10]) — we degrade to the
 * last-known/zero counts rather than surfacing an error.
 */
export interface EventCountSectionProps {
  tabId: number | undefined;
}

const POLL_INTERVAL_MS = 1500;

export function EventCountSection(props: EventCountSectionProps): React.JSX.Element {
  const { tabId } = props;
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
          // SW unavailable / handler error — keep last-known counts.
        });
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tabId]);

  const idle = stats.domMutations === 0 && stats.consoleLogs === 0 && stats.networkRequests === 0;

  return (
    <section className="peek-section" aria-labelledby="peek-events-heading">
      <h2 id="peek-events-heading" className="peek-section-title">
        Live activity
      </h2>
      <p className="peek-stats">
        <span>
          <strong>{stats.domMutations}</strong> DOM mutations
        </span>
        <span aria-hidden="true"> · </span>
        <span>
          <strong>{stats.consoleLogs}</strong> console logs
        </span>
        <span aria-hidden="true"> · </span>
        <span>
          <strong>{stats.networkRequests}</strong> network reqs
        </span>
      </p>
      {idle ? (
        <p className="peek-muted peek-placeholder">
          No activity captured yet. Enable this site and interact with the page.
        </p>
      ) : null}
    </section>
  );
}
