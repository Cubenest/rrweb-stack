import { useFirstRun } from '../firstRun';

/**
 * One-time orientation card shown on first panel open until dismissed. Three
 * short beats: what peek is, what an agent can/can't do, and the trust dial.
 * Renders nothing once dismissed (or if the dismissal read failed — fail toward
 * non-intrusive, handled in useFirstRun).
 */
export function FirstRunCard(): React.JSX.Element | null {
  const { show, dismiss } = useFirstRun();
  if (!show) return null;
  return (
    <section className="peek-firstrun" aria-label="Welcome to peek">
      <h2 className="peek-section-title">Welcome to peek</h2>
      <p className="peek-firstrun-lead">
        peek records this browser&rsquo;s sessions <strong>locally</strong> so your AI coding agent
        can inspect them. Nothing leaves your machine.
      </p>
      <ul className="peek-firstrun-points">
        <li>
          Your agent starts at <strong>Read-only</strong> — it can never click, type, or change a
          page until you raise the trust level below.
        </li>
        <li>
          The <strong>trust dial</strong> sets, per site, exactly how much your agent may do.
        </li>
      </ul>
      <button type="button" className="peek-btn peek-btn-primary" onClick={dismiss}>
        Got it
      </button>
    </section>
  );
}
