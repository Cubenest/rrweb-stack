import { useEffect, useState } from 'react';
import { EMPTY_RECORDER_STATS, type RecorderStats, sendCmd } from '../../../src/messaging/protocol';

/**
 * Live event-count display (P2 PRD §D.3): "127 DOM mutations · 14 console logs
 * · 9 network reqs".
 *
 * PLACEHOLDER (3d-1): the recorder relay that produces real counts lands in
 * chunk 3d-2. Until then the background returns EMPTY_RECORDER_STATS, so this
 * renders zeros with an explicit "not yet recording" note. The wiring (query
 * the SW, render the triple) is real so 3d-2 only has to make the numbers move.
 */
export interface EventCountSectionProps {
  tabId: number | undefined;
}

export function EventCountSection(props: EventCountSectionProps): React.JSX.Element {
  const { tabId } = props;
  const [stats, setStats] = useState<RecorderStats>(EMPTY_RECORDER_STATS);

  useEffect(() => {
    let cancelled = false;
    if (tabId === undefined) {
      setStats(EMPTY_RECORDER_STATS);
      return;
    }
    void sendCmd({ type: 'getRecorderStats', tabId })
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(EMPTY_RECORDER_STATS);
      });
    return () => {
      cancelled = true;
    };
  }, [tabId]);

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
      <p className="peek-muted peek-placeholder">
        Live counts begin once recording is wired up (coming soon).
      </p>
    </section>
  );
}
