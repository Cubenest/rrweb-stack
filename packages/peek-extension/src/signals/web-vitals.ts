/**
 * Web Vitals signal stub (Task 3.27, P2 PRD §I — explicit Phase 4 defer).
 *
 * The full implementation will subscribe to LCP / INP / CLS / FCP / TTFB
 * through the `web-vitals` library (or PerformanceObserver directly) from the
 * MAIN-world recorder, batch them through the ISOLATED relay, and expose them
 * through an MCP tool so the agent can answer "what was the LCP on this
 * page?". For Phase 3d the surface exists; the stub returns no readings.
 *
 * TODO: Phase 4 — wire to the `web-vitals` package (or raw
 * PerformanceObserver) from the MAIN-world recorder and forward through the
 * existing relay channel.
 */

/** A single Web Vital reading. The empty[] return is Phase 4-replaced. */
export interface WebVitalReading {
  readonly name: 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';
  readonly value: number;
  readonly rating: 'good' | 'needs-improvement' | 'poor';
  readonly tsMs: number;
}

export interface WebVitalsCollection {
  readonly readings: readonly WebVitalReading[];
  readonly implemented: boolean;
}

/**
 * Collect Core Web Vitals readings for the current page. STUB — returns an
 * empty collection with `implemented: false` so callers can detect that the
 * feature isn't live yet.
 */
export async function collectWebVitals(): Promise<WebVitalsCollection> {
  return { readings: [], implemented: false };
}
