import { useEffect, useState } from 'react';
import { getShowRecordingBorder, setShowRecordingBorder } from '../../../src/indicators/storage';

/**
 * Global toggle for the in-page recording-border glow (default on). The
 * always-on toolbar badge is unaffected by this setting. Optimistic write with
 * rollback, mirroring the side panel's other persisted controls.
 */
export function RecordingBorderToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getShowRecordingBorder()
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
    void setShowRecordingBorder(next).catch(() => {
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
        <span>Show recording border on the page</span>
      </label>
    </section>
  );
}
