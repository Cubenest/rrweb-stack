import { useCallback, useEffect, useState } from 'react';
import { requestActivation } from '../../../src/activation/request';
import { isOriginEnabled } from '../../../src/activation/storage';
import { sendCmd } from '../../../src/messaging/protocol';
import { CaptureActivate } from './CaptureActivate';
import { CaptureControls } from './CaptureControls';
import { CaptureDeepDisclosure } from './CaptureDeepDisclosure';
import { CaptureLiveActivity } from './CaptureLiveActivity';
import { CaptureMaskNote } from './CaptureMaskNote';

export interface CaptureSectionProps {
  origin: string | null;
  title: string | undefined;
  tabId: number | undefined;
  url: string | undefined;
}

/** "Capture" group: activation CTA when off; live activity + masking note +
 * recorder controls + deep-capture disclosure when recording. Owns the
 * per-origin / per-tab activation state (moved out of App.tsx). */
export function CaptureSection({
  origin,
  title,
  tabId,
  url,
}: CaptureSectionProps): React.JSX.Element {
  const [enabled, setEnabled] = useState(false);
  const [tabEnabled, setTabEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect persisted "all tabs" consent whenever the active origin changes.
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setEnabled(false);
      return;
    }
    void isOriginEnabled(url).then((v) => {
      if (!cancelled) setEnabled(v);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // An activeTab grant is per-tab; clear the "this tab" feedback on tab switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on tabId only.
  useEffect(() => {
    setTabEnabled(false);
  }, [tabId]);

  const onActivate = useCallback(
    async (scope: 'tab' | 'origin') => {
      setError(null);
      setBusy(true);
      try {
        const result = await requestActivation(url, scope);
        if (scope === 'origin') setEnabled(result.granted);
        if (scope === 'tab') setTabEnabled(result.granted);
        // activeTab grants fire no storage/onUpdated listener on an already-loaded
        // page, so ask the SW to inject directly. Fire-and-forget.
        if (scope === 'tab' && result.granted && tabId !== undefined) {
          void sendCmd({ type: 'activateRecorderForTab', tabId }).catch(() => {});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [url, tabId],
  );

  const recording = enabled || tabEnabled;

  return (
    <section className="peek-section peek-capture" aria-labelledby="peek-capture-heading">
      <h2 id="peek-capture-heading" className="peek-section-title">
        <span className={`peek-rec-dot${recording ? ' peek-rec-on' : ''}`} aria-hidden="true" />
        Capture
        {origin ? <span className="peek-capture-origin"> · {origin}</span> : null}
      </h2>

      {origin === null ? (
        <p className="peek-muted">
          This page can&rsquo;t be recorded. Open an <code>http</code> or <code>https</code> site to
          enable peek.
        </p>
      ) : recording ? (
        <>
          <p className="peek-capture-state">
            {enabled ? (
              <>
                Recording <strong>{origin}</strong> on all tabs.
              </>
            ) : (
              <>
                Recording <strong>this tab</strong> ({origin}).
              </>
            )}
          </p>
          <CaptureLiveActivity tabId={tabId} />
          <CaptureMaskNote />
          <CaptureControls />
          <CaptureDeepDisclosure origin={origin} />
        </>
      ) : (
        <CaptureActivate origin={origin} title={title} busy={busy} onActivate={onActivate} />
      )}

      {error ? (
        <p className="peek-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
