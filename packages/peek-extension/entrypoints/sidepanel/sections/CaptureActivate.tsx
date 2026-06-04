/** Activation CTA (the not-recording state of the Capture group). The buttons
 * stay inside the user-gesture click handler — `chrome.permissions.request`
 * requires a gesture (ADR-0008). */
export interface CaptureActivateProps {
  origin: string;
  title: string | undefined;
  busy: boolean;
  onActivate: (scope: 'tab' | 'origin') => void | Promise<void>;
}

export function CaptureActivate({
  origin,
  title,
  busy,
  onActivate,
}: CaptureActivateProps): React.JSX.Element {
  return (
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
  );
}
