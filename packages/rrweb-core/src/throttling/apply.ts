// Public throttling entrypoint — Task 1.4.
//
// `applyLargeDomGuards` is the only function the substrate exports from this
// module (alongside `LARGE_DOM_DEFAULTS`). It composes the three guards from
// `guards.ts` into a single `recordOptions` transform:
//
//   1. Pull recordOptions-shaped defaults (mousemoveWait/sampling/etc.) onto
//      the consumer's options, with the consumer winning on conflicts.
//   2. Replace the consumer's `emit` with a guarded wrapper that runs every
//      event through dataUrl → eventSize → mutation, in that order. The
//      ordering matters: the data-URL guard shrinks oversized snapshot
//      payloads BEFORE the event-size guard measures them, otherwise an
//      oversize data URL would always trip the size cap and silently drop
//      the whole snapshot.
//
// The guards never reach into rrweb's subscription, so this function can't
// truly stop the recorder on its own. The hard-mutation-limit semantics are:
// further events are dropped at the wrapper, AND the consumer's `onLimit`
// callback fires once (consumers wire this to rrweb's teardown if they want
// a true stop).

import type { customEvent, eventWithTime, recordOptions } from '../rrweb.js';
import { LARGE_DOM_DEFAULTS } from './defaults.js';
import {
  type MutationGuardHooks,
  applyDataUrlGuard,
  applyEventSizeGuard,
  applyMutationGuard,
} from './guards.js';

/**
 * Options for `applyLargeDomGuards`. Everything is optional — the function
 * defaults to `LARGE_DOM_DEFAULTS` and a no-op `onWarn` / `onLimit`.
 */
export interface ApplyLargeDomGuardsOptions {
  /**
   * Override the bundled defaults. Useful for products that want to tune the
   * mutation thresholds for their workload — but per IMPLEMENTATION_PLAN.md,
   * tuning happens after we have real-world session data. Use sparingly.
   */
  defaults?: typeof LARGE_DOM_DEFAULTS;
  /**
   * Invoked with the `tracelane.mutation.warn` and `tracelane.event.dropped`
   * breadcrumb custom events. Consumers can forward these to their own
   * telemetry pipeline. Default: no-op.
   */
  onWarn?: (event: customEvent & { timestamp: number }) => void;
  /**
   * Invoked exactly once when the cumulative mutation count exceeds
   * `defaults.mutationLimit`. After this fires, the guard's emit wrapper
   * stops forwarding events. Consumers should call rrweb's `record()`
   * teardown from here if they want to truly halt the recorder.
   */
  onLimit?: () => void;
}

/**
 * Compose the throttling defaults and guard chain onto an rrweb
 * `recordOptions` object.
 *
 * Returns a new `recordOptions` with:
 *   - the first six `LARGE_DOM_DEFAULTS` (mousemoveWait, sampling,
 *     inlineImages, collectFonts, recordCanvas, plus the
 *     `checkoutEveryNms` mapped from `defaults.checkoutEveryMs`) merged in
 *     where the caller didn't already set them; and
 *   - an `emit` wrapper that runs dataUrl → eventSize → mutation in order.
 *
 * Note on semantics: because `applyLargeDomGuards` does not own the rrweb
 * subscription, the hard mutation limit can only stop events from being
 * forwarded from this wrapper onward — it cannot tear down the rrweb
 * `record()` subscription on its own. Wire your own teardown via `onLimit`
 * if you need the recorder itself to stop.
 *
 * @example
 *   const stop = record(
 *     applyLargeDomGuards(
 *       { emit: forwardToTransport },
 *       {
 *         onWarn: (e) => forwardToTransport(e),
 *         onLimit: () => stop?.(),
 *       },
 *     ),
 *   );
 */
export function applyLargeDomGuards(
  recordOpts: recordOptions<eventWithTime>,
  options: ApplyLargeDomGuardsOptions = {},
): recordOptions<eventWithTime> {
  const defaults = options.defaults ?? LARGE_DOM_DEFAULTS;
  const onWarn = options.onWarn ?? noop;

  const callerEmit = recordOpts.emit ?? noopEmit;

  // Build the guard chain. Order is significant — see file header.
  // Note: `onLimit` is spread conditionally because tsconfig
  // `exactOptionalPropertyTypes: true` disallows `undefined` on an optional
  // field — the property either exists with a function value or is absent.
  const mutationHooks: MutationGuardHooks = {
    softWarnAt: defaults.mutationSoftWarnAt,
    hardLimit: defaults.mutationLimit,
    emitWarn: onWarn,
    emitLimit: onWarn,
    ...(options.onLimit !== undefined ? { onLimit: options.onLimit } : {}),
  };

  const guardedEmit = applyMutationGuard((event, isCheckout) => {
    const post = applyEventSizeGuard(event, defaults.singleEventMaxBytes, onWarn);
    if (post === null) return;
    callerEmit(post, isCheckout);
  }, mutationHooks);

  const composedEmit = (event: eventWithTime, isCheckout?: boolean): void => {
    const post = applyDataUrlGuard(event, defaults.dataUrlMaxBytes);
    guardedEmit(post, isCheckout);
  };

  // Merge — caller wins on every key that's explicitly set.
  const merged: recordOptions<eventWithTime> = {
    mousemoveWait: defaults.mousemoveWait,
    sampling: { ...defaults.sampling },
    inlineImages: defaults.inlineImages,
    collectFonts: defaults.collectFonts,
    recordCanvas: defaults.recordCanvas,
    checkoutEveryNms: defaults.checkoutEveryMs,
    ...recordOpts,
    // emit is always the composed wrapper; the caller's emit has been captured
    // by `callerEmit` above.
    emit: composedEmit,
  };

  // `sampling` is a nested object — re-merge so caller-provided keys win.
  if (recordOpts.sampling !== undefined) {
    merged.sampling = { ...defaults.sampling, ...recordOpts.sampling };
  }

  return merged;
}

function noop(): void {
  /* intentionally empty — default onWarn / onLimit */
}

function noopEmit(_event: eventWithTime, _isCheckout?: boolean): void {
  /* intentionally empty — fallback when caller didn't provide an emit */
}
