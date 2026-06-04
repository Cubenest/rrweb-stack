/** Masking reassurance. Masking always runs in the ISOLATED relay (mask.ts), so
 * this is truthful without a count. Per-field counts are deferred (RecorderStats
 * has no mask field yet) — we never show a fabricated number. */
export function CaptureMaskNote(): React.JSX.Element {
  return (
    <p className="peek-mask-note">
      <span aria-hidden="true">🔒 </span>
      Passwords, emails, and detected secrets are masked before anything is captured.
      <span className="peek-muted"> (per-field counts coming soon)</span>
    </p>
  );
}
