/**
 * Security signals stub (Task 3.27, P2 PRD §K — explicit Phase 4 defer).
 *
 * The full implementation will collect security-posture signals (CSP header
 * presence + directives, mixed-content blocks, HSTS, X-Content-Type-Options,
 * cookie attribute audit) from the live page and surface them through an MCP
 * tool. Useful for AI-assisted security reviews of an app the agent is
 * working on. For Phase 3d the surface exists; the stub reports no findings.
 *
 * TODO: Phase 4 — collect from `chrome.webRequest` headers + the page's
 * `document.securityPolicyViolationEvent` and Network responses (Deep
 * capture optional).
 */

/** A single security signal. The empty[] return is Phase 4-replaced. */
export interface SecuritySignal {
  readonly category: 'csp' | 'mixed-content' | 'hsts' | 'cookies' | 'cors';
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
}

export interface SecuritySignalsReport {
  readonly signals: readonly SecuritySignal[];
  readonly implemented: boolean;
}

/**
 * Run the security-signals collectors against the current page. STUB —
 * returns an empty report with `implemented: false` so callers can detect
 * that the feature isn't live yet.
 */
export async function runSecuritySignals(): Promise<SecuritySignalsReport> {
  return { signals: [], implemented: false };
}
