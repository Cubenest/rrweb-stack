/** Recorder controls. Disabled placeholders that make the safety model's shape
 * visible while honestly signalling they're not wired (pause + session delete
 * are deferred backend work). */
export function CaptureControls(): React.JSX.Element {
  return (
    <div className="peek-controls">
      <div className="peek-button-row">
        <button type="button" className="peek-button" disabled aria-disabled="true">
          <span aria-hidden="true">⏸ </span>Pause
        </button>
        <button
          type="button"
          className="peek-button peek-button-danger"
          disabled
          aria-disabled="true"
        >
          <span aria-hidden="true">■ </span>Stop &amp; delete
        </button>
      </div>
      <p className="peek-muted peek-hint">
        <span className="peek-soon">Soon</span> Recorder controls (pause, stop &amp; delete) arrive
        in a later build.
      </p>
    </div>
  );
}
