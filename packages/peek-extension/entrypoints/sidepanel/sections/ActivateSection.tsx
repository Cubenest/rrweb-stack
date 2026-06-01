/**
 * Activate-on-this-site CTA (P2 PRD §D.1, ADR-0008). FUNCTIONAL this chunk.
 *
 * Renders the two grant scopes from §D.1:
 *   "Enable recording on https://example.com? [Just this tab] [All tabs on this domain]"
 *
 * Both buttons are inside the user-gesture click handler so
 * `chrome.permissions.request` works (it requires a gesture).
 */
export interface ActivateSectionProps {
  /** Bare origin of the active tab, or null if the URL isn't activatable. */
  origin: string | null;
  title: string | undefined;
  /** Whether the origin already has persisted "all tabs" consent. */
  enabled: boolean;
  /** Whether "Just this tab" (activeTab) was granted for the current tab. */
  tabEnabled: boolean;
  busy: boolean;
  error: string | null;
  onActivate: (scope: 'tab' | 'origin') => void | Promise<void>;
}

export function ActivateSection(props: ActivateSectionProps): React.JSX.Element {
  const { origin, title, enabled, tabEnabled, busy, error, onActivate } = props;

  return (
    <section className="peek-section" aria-labelledby="peek-activate-heading">
      <h2 id="peek-activate-heading" className="peek-section-title">
        Recording
      </h2>

      {origin === null ? (
        <p className="peek-muted">
          This page can&rsquo;t be recorded. Open an <code>http</code> or <code>https</code> site to
          enable peek.
        </p>
      ) : enabled ? (
        <div className="peek-enabled">
          <p>
            Recording is enabled for <strong>{origin}</strong>.
          </p>
          {/* STOP & DELETE + Pause controls land with the recorder (3d-2/3d-3). */}
          <p className="peek-muted">Recording controls arrive in a later build.</p>
        </div>
      ) : tabEnabled ? (
        <div className="peek-enabled">
          <p>
            Recording active for <strong>this tab</strong> ({origin}).
          </p>
          <p className="peek-muted">
            Granted for now without persisting. To remember <strong>{origin}</strong> across tabs
            and devices, choose &ldquo;All tabs on this domain&rdquo; next time. Recording controls
            arrive in a later build.
          </p>
        </div>
      ) : (
        <div className="peek-activate">
          <p>
            Enable recording on <strong>{origin}</strong>
            {title ? <span className="peek-muted"> ({title})</span> : null}?
          </p>
          <div className="peek-button-row">
            <button
              type="button"
              className="peek-button"
              disabled={busy}
              onClick={() => void onActivate('tab')}
            >
              Just this tab
            </button>
            <button
              type="button"
              className="peek-button peek-button-primary"
              disabled={busy}
              onClick={() => void onActivate('origin')}
            >
              All tabs on this domain
            </button>
          </div>
          <p className="peek-muted peek-hint">
            &ldquo;Just this tab&rdquo; records this site for now without persisting your choice.
            &ldquo;All tabs on this domain&rdquo; remembers it and syncs across your devices.
          </p>
        </div>
      )}

      {error ? (
        <p className="peek-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
