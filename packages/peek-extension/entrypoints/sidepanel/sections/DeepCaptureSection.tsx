/**
 * Deep capture toggle (Task 3.26, ADR-0010).
 *
 * Deep capture attaches `chrome.debugger` to the active tab so peek can
 * record response BODIES (not just headers + URLs). It shows the "Peek is
 * debugging this browser" yellow banner across every Chrome tab, so the
 * feature is OFF by default + opt-in per-site.
 *
 * Flow:
 *   1. The "Enable" button click is the user-gesture
 *      `chrome.permissions.request({ permissions: ['debugger'] })` lives in
 *      (the `debugger` permission is in optional_permissions per wxt.config —
 *      it has no install-time prompt).
 *   2. On grant, persist the origin to `chrome.storage.sync`
 *      (`peek:deepCaptureOrigins`). The SW reads the same key on tab
 *      activation/load + attaches if persisted.
 *   3. The yellow-banner warning copy is rendered prominently above the
 *      toggle so the user knows what they're signing up for.
 */

import { useEffect, useState } from 'react';
import {
  disableDeepCapture,
  enableDeepCapture,
  isDeepCaptureEnabled,
} from '../../../src/deep-capture/storage';

export interface DeepCaptureSectionProps {
  /** Bare origin of the active tab, or null if the URL isn't activatable. */
  origin: string | null;
}

export function DeepCaptureSection({ origin }: DeepCaptureSectionProps): React.JSX.Element {
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
      // P-14 (2026-05-28): `debugger` is now in static `permissions` (Chrome
      // 121+ banned it from optional_permissions). `chrome.permissions.request`
      // for an already-granted permission resolves with `true` immediately and
      // shows no dialog — left as defense-in-depth in case a future Chrome
      // revision moves it back to optional, or some packaging path strips it.
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
      // We deliberately do NOT remove the `debugger` permission here. The
      // user may have multiple origins enabled; revoking the permission
      // could break those. Detach happens in the SW.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !origin || !loaded || busy;

  return (
    <section className="peek-section" aria-labelledby="peek-deep-heading">
      <h2 id="peek-deep-heading" className="peek-section-title">
        Deep capture (advanced)
      </h2>
      <div className="peek-warning" role="note">
        <strong>Heads up.</strong> Deep capture uses Chrome&rsquo;s debugger API to record response
        bodies. While it&rsquo;s on, Chrome shows a yellow &ldquo;
        <em>peek is debugging this browser</em>&rdquo; bar at the top of every tab. Off by default
        &mdash; enable only when you need response bodies in your recordings.
      </div>
      {origin === null ? (
        <p className="peek-muted peek-placeholder">
          Open this panel on an http(s) page to toggle Deep capture per site.
        </p>
      ) : enabled ? (
        <div className="peek-deep-on">
          <p>
            Deep capture is <strong>on</strong> for <code>{origin}</code>.
          </p>
          <button
            type="button"
            className="peek-button"
            disabled={disabled}
            onClick={() => void onDisable()}
          >
            Turn off for this site
          </button>
        </div>
      ) : (
        <div className="peek-deep-off">
          <p>
            Enable Deep capture for <code>{origin}</code>?
          </p>
          <button
            type="button"
            className="peek-button peek-button-primary"
            disabled={disabled}
            onClick={() => void onEnable()}
          >
            Enable Deep capture
          </button>
        </div>
      )}
      {error !== null && (
        <p className="peek-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
