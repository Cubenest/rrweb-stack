import { useEffect, useState } from 'react';
import {
  disableDeepCapture,
  enableDeepCapture,
  isDeepCaptureEnabled,
} from '../../../src/deep-capture/storage';

/** Deep capture, demoted to an advanced disclosure. Logic unchanged from the
 * former DeepCaptureSection: the Enable click is the user-gesture
 * `chrome.permissions.request({permissions:['debugger']})` (debugger is in
 * static permissions since Chrome 121 — P-14 — so this resolves immediately;
 * kept as defense-in-depth). On grant, persist the origin; the SW attaches. */
export function CaptureDeepDisclosure({ origin }: { origin: string | null }): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!origin) {
      setEnabled(false);
      setLoaded(true);
      return;
    }
    void isDeepCaptureEnabled(origin).then((v) => {
      if (!cancelled) {
        setEnabled(v);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [origin]);

  async function onEnable(): Promise<void> {
    if (!origin) return;
    setError(null);
    setBusy(true);
    try {
      const granted = await chrome.permissions.request({ permissions: ['debugger'] });
      if (!granted) {
        setBusy(false);
        return;
      }
      await enableDeepCapture(origin);
      setEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable(): Promise<void> {
    if (!origin) return;
    setError(null);
    setBusy(true);
    try {
      await disableDeepCapture(origin);
      setEnabled(false);
      // Deliberately do NOT revoke the `debugger` permission (other origins may
      // use it). The SW handles detach.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !origin || !loaded || busy;

  return (
    <details className="peek-disclosure peek-deep">
      <summary className="peek-disclosure-summary">
        Deep capture <span className="peek-muted">(advanced · {enabled ? 'on' : 'off'})</span>
      </summary>
      <div className="peek-disclosure-body">
        <div className="peek-warning" role="note">
          <strong>Heads up.</strong> Deep capture uses Chrome&rsquo;s debugger API to record
          response bodies. While it&rsquo;s on, Chrome shows a yellow &ldquo;
          <em>peek is debugging this browser</em>&rdquo; bar at the top of every tab.
        </div>
        {enabled ? (
          <button
            type="button"
            className="peek-button"
            disabled={disabled}
            onClick={() => void onDisable()}
          >
            Turn off for this site
          </button>
        ) : (
          <button
            type="button"
            className="peek-button peek-button-primary"
            disabled={disabled}
            onClick={() => void onEnable()}
          >
            Enable Deep capture
          </button>
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
