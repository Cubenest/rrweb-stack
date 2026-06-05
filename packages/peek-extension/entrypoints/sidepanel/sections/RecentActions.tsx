/**
 * Recent-actions disclosure — the "did the agent do that?" audit preview.
 * Placeholder copy until the audit-log writer lands (deferred); ports the
 * former AuditLogSection text into a collapsible row under Agent control.
 */
export function RecentActions(): React.JSX.Element {
  return (
    <details className="peek-disclosure">
      <summary className="peek-disclosure-summary">Recent actions</summary>
      <div className="peek-disclosure-body">
        <p className="peek-muted peek-placeholder">
          No agent actions yet. Every action an AI agent takes will appear here and in{' '}
          <code>~/.peek/audit.log</code> (coming soon).
        </p>
      </div>
    </details>
  );
}
