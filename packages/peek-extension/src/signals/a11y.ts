/**
 * Accessibility signal stub (Task 3.27, P2 PRD §J — explicit Phase 4 defer).
 *
 * The full implementation will run axe-core in the ISOLATED content script,
 * collect violations + impacts, and expose them through an MCP tool so the
 * agent can answer "what accessibility issues does this page have?". For
 * Phase 3d the surface exists (so MCP tool wiring + side-panel toggles can
 * call it without errors), but it returns an empty no-op result.
 *
 * TODO: Phase 4 — wire to @axe-core/cdp (or run axe-core inside the page via
 * the existing ISOLATED relay) and surface results through a new MCP tool.
 */

/** Shape an axe violation will take; the empty[] return is Phase 4-replaced. */
export interface A11yViolation {
  readonly id: string;
  readonly impact: 'minor' | 'moderate' | 'serious' | 'critical';
  readonly description: string;
  readonly nodes: readonly { readonly target: readonly string[] }[];
}

export interface A11yScanResult {
  readonly violations: readonly A11yViolation[];
  /** True once the stub is replaced with a real scanner. */
  readonly implemented: boolean;
}

/**
 * Scan the current page for accessibility violations. STUB — returns an empty
 * result with `implemented: false` so callers can detect that the feature
 * isn't live yet without crashing.
 */
export async function scanA11y(): Promise<A11yScanResult> {
  return { violations: [], implemented: false };
}
