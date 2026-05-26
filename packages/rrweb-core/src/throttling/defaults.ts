// Large-DOM throttling defaults — Task 1.4.
//
// The first six values (mousemoveWait / sampling.scroll / sampling.input /
// inlineImages / collectFonts / recordCanvas) are pass-through rrweb config
// inherited from the PostHog fork's session-replay tuning. They prevent
// recordings from exploding on heavy SPAs.
//
// The last five values are tracelane-specific guard thresholds applied via
// `applyLargeDomGuards`:
//   - mutationLimit / mutationSoftWarnAt — Sentry-parity mutation guard
//   - dataUrlMaxBytes                    — PostHog-parity data-URL guard
//   - singleEventMaxBytes                — Kafka-class ingest realism cap
//   - checkoutEveryMs                    — re-snapshot cadence to dodge the
//                                          documented PostHog SPA
//                                          missing-recording bug
//
// All values are frozen at module load so neither the substrate nor consumers
// can mutate them at runtime; consumers needing different thresholds pass a
// fresh `defaults` object into `applyLargeDomGuards`.
//
// See shared-preamble §2 ("Large-DOM throttling defaults") and ADR-0002 for
// the rationale and source links.

/**
 * Default throttling configuration for the substrate.
 *
 * The first six properties land directly on rrweb's `recordOptions`; the
 * remaining five are interpreted by `applyLargeDomGuards`. Values match the
 * shared-preamble §2 numbers verbatim — tune only on the back of real-world
 * session data.
 */
export const LARGE_DOM_DEFAULTS = Object.freeze({
  /** Throttle window for mousemove sampling, in milliseconds. */
  mousemoveWait: 50,

  /**
   * Frozen rrweb sampling strategy. `scroll: 100` throttles scroll events;
   * `input: 'last'` only emits the final input value rather than every
   * keystroke (mirrors PostHog's session-replay default).
   */
  sampling: Object.freeze({
    scroll: 100,
    input: 'last' as const,
  }),

  /** Disable base64-inlined images — too expensive on rich pages. */
  inlineImages: false,

  /** Disable font sniffing — produces enormous events on font-heavy sites. */
  collectFonts: false,

  /** Disable canvas recording — canvas streams alone can dwarf a session. */
  recordCanvas: false,

  /**
   * Hard mutation cap (cumulative across the recording). When exceeded,
   * `applyLargeDomGuards` stops forwarding events and invokes the consumer's
   * `onLimit` callback (the consumer can then call rrweb's teardown).
   */
  mutationLimit: 10000,

  /**
   * Per-batch soft warning threshold. When a single mutation batch exceeds
   * this, the guard emits one `tracelane.mutation.warn` custom event per
   * batch — never spammed.
   */
  mutationSoftWarnAt: 750,

  /**
   * Maximum size for a single `data:` URL value (in `src`/`href` attributes).
   * Larger values are replaced with the SVG placeholder declared in
   * `guards.ts`. 5 MB matches PostHog's session-replay tuning.
   */
  dataUrlMaxBytes: 5 * 1024 * 1024, // 5 MB

  /**
   * Maximum JSON-stringified size for a single event. Anything larger is
   * dropped (replaced with a `tracelane.event.dropped` breadcrumb) — we
   * don't try to truncate inside an event because the result is rarely
   * replayable.
   */
  singleEventMaxBytes: 1024 * 1024, // 1 MB

  /**
   * Buffer roll-over cadence in milliseconds. rrweb re-emits a full
   * snapshot on this interval. 30s avoids the documented PostHog
   * single-page-app missing-recording bug.
   */
  checkoutEveryMs: 30_000,
});

export type LargeDomDefaults = typeof LARGE_DOM_DEFAULTS;
