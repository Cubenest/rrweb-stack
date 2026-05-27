import { useCallback, useEffect, useState } from 'react';
import { originFromUrl } from '../../src/activation/origin';
import { requestActivation } from '../../src/activation/request';
import { isOriginEnabled } from '../../src/activation/storage';
import { ActivateSection } from './sections/ActivateSection';
import { AuditLogSection } from './sections/AuditLogSection';
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

  const onActivate = useCallback(
    async (scope: 'tab' | 'origin') => {
      setError(null);
      setBusy(true);
      try {
        const result = await requestActivation(url, scope);
        if (scope === 'origin') setEnabled(result.granted);
        // NOTE (3d-2): on grant, kick off dynamic MAIN-world rrweb injection
        // for `tabId` here. Deliberately not wired in this chunk.
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [url],
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
        busy={busy}
        error={error}
        onActivate={onActivate}
      />

      <EventCountSection tabId={tabId} />

      <PermissionLevelSection />

      <AuditLogSection />

      <footer className="peek-footer">
        <span>v0.1.0-alpha · local-only · no telemetry</span>
      </footer>
    </main>
  );
}
