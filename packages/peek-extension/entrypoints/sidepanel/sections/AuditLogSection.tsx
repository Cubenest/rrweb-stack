/**
 * Audit-log preview (ADR-0010, P2 PRD §D.3 / §H.3): the running record of
 * agent actions ("did Claude do that?"). The append-only JSONL log lives at
 * ~/.peek/audit.log, owned by the native host.
 *
 * PLACEHOLDER (3d-1): the audit-log writer and the native-host query that
 * feeds this preview land in chunk 3d-3. This renders the empty state and the
 * structure so 3d-3 only has to populate the list.
 */
export function AuditLogSection(): React.JSX.Element {
  return (
    <section className="peek-section" aria-labelledby="peek-audit-heading">
      <h2 id="peek-audit-heading" className="peek-section-title">
        Audit log
      </h2>
      <p className="peek-muted peek-placeholder">
        No agent actions yet. Every action an AI agent takes will appear here and in{' '}
        <code>~/.peek/audit.log</code> (coming soon).
      </p>
    </section>
  );
}
