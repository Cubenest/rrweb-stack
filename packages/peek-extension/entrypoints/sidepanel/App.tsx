import { useCallback, useEffect, useState } from 'react';
import { originFromUrl } from '../../src/activation/origin';
import { requestActivation } from '../../src/activation/request';
import { isOriginEnabled } from '../../src/activation/storage';
import { sendCmd } from '../../src/messaging/protocol';
import { ActivateSection } from './sections/ActivateSection';
import { AuditLogSection } from './sections/AuditLogSection';
import { DeepCaptureSection } from './sections/DeepCaptureSection';
import { EventCountSection } from './sections/EventCountSection';
import { PermissionLevelSection } from './sections/PermissionLevelSection';
import { useActiveTab } from './useActiveTab';

/**
 * peek side panel (P2 PRD §A.6). Four sections, top to bottom:
 *   1. Activate-on-this-site CTA      — FUNCTIONAL in 3d-1.
 *   2. Live event-count display       — placeholder (recorder relay = 3d-2).
 *   3. Permission-level selector 0–4  — placeholder (wiring = 3d-3).
 *   4. Audit-log preview              — placeholder (audit writer = 3d-3).
 *
 * The Activate CTA is the load-bearing flow for this chunk: it requests the
 * per-origin host permission from the click gesture and persists consent
 * (ADR-0008).
 */
export function App(): React.JSX.Element {
  const { tabId, url, title } = useActiveTab();
  const origin = originFromUrl(url);
  const [enabled, setEnabled] = useState(false);
  // "Just this tab" (activeTab) grant feedback. Keyed on the active tab, so it
  // resets when the user switches tabs (an activeTab grant is per-tab and does
  // not carry over). The persisted origin grant uses `enabled` instead.
  const [tabEnabled, setTabEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect persisted consent whenever the active origin changes.
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

  // A per-tab (activeTab) grant does not survive a tab switch; clear the
  // "active for this tab" feedback whenever the active tab changes.
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
        // Origin grants trigger injection via the SW's storage.onChanged listener
        // (P-11). activeTab grants persist nothing and fire no other listener, so
        // the SW would never inject — ask it to inject for this tab explicitly.
        // Fire-and-forget: a failed inject doesn't roll back the visible "Recording
        // active for this tab" state — the grant itself succeeded.
        if (scope === 'tab' && result.granted && tabId !== undefined) {
          // SW handles injection; we don't need to await it before resolving
          // the click handler. SW unavailable / inject error is logged on the
          // SW side; caller-visible state (`tabEnabled`) already reflects the
          // user's permission choice, so we silently degrade here.
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

  return (
    <main className="peek-panel">
      <header className="peek-header">
        <h1 className="peek-title">peek</h1>
        <span className="peek-tagline">browser session capture for AI agents</span>
      </header>

      <ActivateSection
        origin={origin}
        title={title}
        enabled={enabled}
        tabEnabled={tabEnabled}
        busy={busy}
        error={error}
        onActivate={onActivate}
      />

      <EventCountSection tabId={tabId} />

      <PermissionLevelSection origin={origin} />

      <DeepCaptureSection origin={origin} />

      <AuditLogSection />

      <footer className="peek-footer">
        <span>v0.1.0-alpha · local-only · no telemetry</span>
      </footer>
    </main>
  );
}
