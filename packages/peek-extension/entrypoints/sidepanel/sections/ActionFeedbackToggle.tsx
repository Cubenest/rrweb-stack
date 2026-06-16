import { useEffect, useState } from 'react';
import { getShowActionFeedback, setShowActionFeedback } from '../../../src/indicators/storage';

/**
 * Global toggle for the in-page action-feedback cue (default on). Optimistic
 * write with rollback, mirroring the side panel's other persisted controls.
 */
export function ActionFeedbackToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getShowActionFeedback()
      .then((v) => {
        if (!cancelled) {
          setEnabled(v);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onToggle(next: boolean): void {
    setEnabled(next); // optimistic
    void setShowActionFeedback(next).catch(() => {
      setEnabled(!next); // rollback on write failure
    });
  }

  return (
    <section className="peek-prefs">
      <label className="peek-pref-row">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!loaded}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>Show action feedback on the page</span>
      </label>
    </section>
  );
}
