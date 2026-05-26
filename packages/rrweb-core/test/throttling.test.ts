// @vitest-environment jsdom
// Throttling defaults + guards — Task 1.4 test suite.
//
// Covers:
//   - LARGE_DOM_DEFAULTS shape, exact values, deep freeze
//   - applyLargeDomGuards recordOpts merge (defaults + caller overrides)
//   - mutation guard: soft warn fires once per batch above threshold, never
//     at/below; hard limit fires once and stops forwarding
//   - data-URL guard: replaces oversized data: URLs in FullSnapshot and in
//     IncrementalSnapshot.Mutation adds; preserves small data URLs and non-
//     data URLs untouched
//   - event-size guard: drops oversized events, emits the dropped
//     breadcrumb, preserves under-cap events
//   - ordering: data-URL guard runs BEFORE event-size guard
//
// All fixtures are handwritten `eventWithTime` objects — we don't boot a real
// recorder here. Per the @vitest-environment pragma we run under jsdom for
// parity with the masking suite.

import { describe, expect, test } from 'vitest';
import { EventType, IncrementalSource } from '../src/rrweb';
import type { customEvent, eventWithTime } from '../src/rrweb';
import { LARGE_DOM_DEFAULTS, applyLargeDomGuards } from '../src/throttling';
import {
  DATA_URL_PLACEHOLDER,
  applyDataUrlGuard,
  applyEventSizeGuard,
  applyMutationGuard,
} from '../src/throttling/guards';

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

function makeFullSnapshot(srcValue: string): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    timestamp: 1_000,
    data: {
      node: {
        type: 0, // NodeType.Document
        id: 1,
        childNodes: [
          {
            type: 2, // NodeType.Element
            id: 2,
            tagName: 'img',
            attributes: { src: srcValue },
            childNodes: [],
          },
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
  } as unknown as eventWithTime;
}

function makeMutationEvent(count: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    timestamp: 2_000,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds: Array.from({ length: count }, (_, i) => ({
        parentId: 1,
        nextId: null,
        node: { type: 2, id: 100 + i, tagName: 'span', attributes: {}, childNodes: [] },
      })),
    },
  } as unknown as eventWithTime;
}

function makeNonMutationIncremental(): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    timestamp: 3_000,
    data: {
      source: IncrementalSource.Scroll,
      id: 1,
      x: 0,
      y: 100,
    },
  } as unknown as eventWithTime;
}

// ────────────────────────────────────────────────────────────────────────────
// LARGE_DOM_DEFAULTS shape + immutability
// ────────────────────────────────────────────────────────────────────────────

describe('LARGE_DOM_DEFAULTS', () => {
  test('exposes every documented key with the documented value', () => {
    expect(LARGE_DOM_DEFAULTS.mousemoveWait).toBe(50);
    expect(LARGE_DOM_DEFAULTS.sampling.scroll).toBe(100);
    expect(LARGE_DOM_DEFAULTS.sampling.input).toBe('last');
    expect(LARGE_DOM_DEFAULTS.inlineImages).toBe(false);
    expect(LARGE_DOM_DEFAULTS.collectFonts).toBe(false);
    expect(LARGE_DOM_DEFAULTS.recordCanvas).toBe(false);
    expect(LARGE_DOM_DEFAULTS.mutationLimit).toBe(10000);
    expect(LARGE_DOM_DEFAULTS.mutationSoftWarnAt).toBe(750);
    expect(LARGE_DOM_DEFAULTS.dataUrlMaxBytes).toBe(5 * 1024 * 1024);
    expect(LARGE_DOM_DEFAULTS.singleEventMaxBytes).toBe(1024 * 1024);
    expect(LARGE_DOM_DEFAULTS.checkoutEveryMs).toBe(30_000);
  });

  test('is frozen at the top level', () => {
    expect(Object.isFrozen(LARGE_DOM_DEFAULTS)).toBe(true);
  });

  test('is frozen on the nested sampling object', () => {
    expect(Object.isFrozen(LARGE_DOM_DEFAULTS.sampling)).toBe(true);
  });

  test('throws (strict) or silently no-ops when a consumer attempts mutation', () => {
    // In strict mode (modules are always strict), reassigning a property on
    // a frozen object throws. The test runs in ESM so `'use strict'` is
    // implicit.
    expect(() => {
      (LARGE_DOM_DEFAULTS as unknown as { mousemoveWait: number }).mousemoveWait = 999;
    }).toThrow(TypeError);
  });

  test('throws on nested sampling mutation in strict mode', () => {
    expect(() => {
      (LARGE_DOM_DEFAULTS.sampling as unknown as { scroll: number }).scroll = 999;
    }).toThrow(TypeError);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyLargeDomGuards — recordOptions merge
// ────────────────────────────────────────────────────────────────────────────

describe('applyLargeDomGuards — recordOptions merge', () => {
  test('fills in default mousemoveWait / inlineImages / collectFonts / recordCanvas when caller omits', () => {
    const merged = applyLargeDomGuards({ emit: () => {} });
    expect(merged.mousemoveWait).toBe(50);
    expect(merged.inlineImages).toBe(false);
    expect(merged.collectFonts).toBe(false);
    expect(merged.recordCanvas).toBe(false);
  });

  test('fills in default sampling.scroll and sampling.input', () => {
    const merged = applyLargeDomGuards({ emit: () => {} });
    expect(merged.sampling?.scroll).toBe(100);
    expect(merged.sampling?.input).toBe('last');
  });

  test('maps defaults.checkoutEveryMs onto recordOptions.checkoutEveryNms', () => {
    const merged = applyLargeDomGuards({ emit: () => {} });
    expect(merged.checkoutEveryNms).toBe(30_000);
  });

  test('caller-provided values override defaults', () => {
    const merged = applyLargeDomGuards({
      emit: () => {},
      mousemoveWait: 200,
      inlineImages: true,
      recordCanvas: true,
    });
    expect(merged.mousemoveWait).toBe(200);
    expect(merged.inlineImages).toBe(true);
    expect(merged.recordCanvas).toBe(true);
  });

  test('caller-provided nested sampling keys win, but unset keys fall back to defaults', () => {
    const merged = applyLargeDomGuards({
      emit: () => {},
      sampling: { scroll: 250 },
    });
    expect(merged.sampling?.scroll).toBe(250);
    // input was not overridden — default 'last' should fill in.
    expect(merged.sampling?.input).toBe('last');
  });

  test('replaces the caller emit with a wrapped one', () => {
    const callerEmit = (): void => {};
    const merged = applyLargeDomGuards({ emit: callerEmit });
    expect(merged.emit).not.toBe(callerEmit);
    expect(typeof merged.emit).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyMutationGuard — soft + hard thresholds
// ────────────────────────────────────────────────────────────────────────────

describe('applyMutationGuard — soft warn', () => {
  test('does NOT emit a warn at the threshold (count === 750)', () => {
    const warns: customEvent[] = [];
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 750,
      hardLimit: 10_000,
      emitWarn: (e) => warns.push(e),
      emitLimit: () => {},
    });
    wrapped(makeMutationEvent(750));
    expect(warns.length).toBe(0);
  });

  test('does NOT emit a warn below the threshold (count === 749)', () => {
    const warns: customEvent[] = [];
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 750,
      hardLimit: 10_000,
      emitWarn: (e) => warns.push(e),
      emitLimit: () => {},
    });
    wrapped(makeMutationEvent(749));
    expect(warns.length).toBe(0);
  });

  test('emits exactly one warn per batch above the threshold', () => {
    const warns: customEvent[] = [];
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 750,
      hardLimit: 100_000, // keep the hard cap out of the way for this test
      emitWarn: (e) => warns.push(e),
      emitLimit: () => {},
    });
    wrapped(makeMutationEvent(800));
    expect(warns.length).toBe(1);
    expect(warns[0]?.data.tag).toBe('tracelane.mutation.warn');
    expect((warns[0]?.data.payload as { count: number }).count).toBe(800);
  });

  test('emits a separate warn for each batch that exceeds the threshold', () => {
    const warns: customEvent[] = [];
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 750,
      hardLimit: 100_000,
      emitWarn: (e) => warns.push(e),
      emitLimit: () => {},
    });
    wrapped(makeMutationEvent(800));
    wrapped(makeMutationEvent(900));
    expect(warns.length).toBe(2);
  });
});

describe('applyMutationGuard — hard limit', () => {
  test('does NOT trigger at the limit boundary (cumulative === 10_000)', () => {
    const limits: customEvent[] = [];
    let onLimitCalls = 0;
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 100_000, // suppress the soft warn for this test
      hardLimit: 10_000,
      emitWarn: () => {},
      emitLimit: (e) => limits.push(e),
      onLimit: () => onLimitCalls++,
    });
    // Two batches of 5000 → cumulative 10_000, exactly at limit.
    wrapped(makeMutationEvent(5_000));
    wrapped(makeMutationEvent(5_000));
    expect(limits.length).toBe(0);
    expect(onLimitCalls).toBe(0);
  });

  test('triggers when cumulative exceeds the hard limit', () => {
    const limits: customEvent[] = [];
    let onLimitCalls = 0;
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 100_000,
      hardLimit: 10_000,
      emitWarn: () => {},
      emitLimit: (e) => limits.push(e),
      onLimit: () => onLimitCalls++,
    });
    wrapped(makeMutationEvent(5_000));
    wrapped(makeMutationEvent(5_001)); // cumulative 10_001 > 10_000
    expect(limits.length).toBe(1);
    expect(limits[0]?.data.tag).toBe('tracelane.mutation.limit');
    expect((limits[0]?.data.payload as { totalCount: number }).totalCount).toBe(10_001);
    expect(onLimitCalls).toBe(1);
  });

  test('stops forwarding events after the hard limit is reached', () => {
    const forwarded: eventWithTime[] = [];
    const wrapped = applyMutationGuard((event) => forwarded.push(event), {
      softWarnAt: 100_000,
      hardLimit: 10_000,
      emitWarn: () => {},
      emitLimit: () => {},
    });
    wrapped(makeMutationEvent(11_000)); // trip the limit on the very first batch
    wrapped(makeMutationEvent(50)); // should be dropped
    wrapped(makeNonMutationIncremental()); // should also be dropped
    expect(forwarded.length).toBe(0);
  });

  test('fires onLimit exactly once even if more events come in', () => {
    let onLimitCalls = 0;
    const wrapped = applyMutationGuard(() => {}, {
      softWarnAt: 100_000,
      hardLimit: 100,
      emitWarn: () => {},
      emitLimit: () => {},
      onLimit: () => onLimitCalls++,
    });
    wrapped(makeMutationEvent(200));
    wrapped(makeMutationEvent(200));
    wrapped(makeMutationEvent(200));
    expect(onLimitCalls).toBe(1);
  });

  test('forwards events normally before the limit', () => {
    const forwarded: eventWithTime[] = [];
    const wrapped = applyMutationGuard((event) => forwarded.push(event), {
      softWarnAt: 100_000,
      hardLimit: 10_000,
      emitWarn: () => {},
      emitLimit: () => {},
    });
    wrapped(makeMutationEvent(100));
    wrapped(makeNonMutationIncremental());
    expect(forwarded.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyDataUrlGuard
// ────────────────────────────────────────────────────────────────────────────

describe('applyDataUrlGuard — FullSnapshot', () => {
  test('replaces an oversized data: URL on a FullSnapshot child', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(11)}`;
    const event = makeFullSnapshot(oversized);
    const guarded = applyDataUrlGuard(event, 10);
    // Walk back down to the child node we know we put a `src` on.
    const childNodes = (
      guarded.data as { node: { childNodes: Array<{ attributes: { src: string } }> } }
    ).node.childNodes;
    expect(childNodes[0]?.attributes.src).toBe(DATA_URL_PLACEHOLDER);
  });

  test('leaves small data: URLs untouched', () => {
    const small = 'data:image/png;base64,AAAA';
    const event = makeFullSnapshot(small);
    const guarded = applyDataUrlGuard(event, 1024);
    const childNodes = (
      guarded.data as { node: { childNodes: Array<{ attributes: { src: string } }> } }
    ).node.childNodes;
    expect(childNodes[0]?.attributes.src).toBe(small);
  });

  test('leaves non-data URLs untouched even when they exceed the cap', () => {
    const longHttp = `https://example.com/${'a'.repeat(10_000)}`;
    const event = makeFullSnapshot(longHttp);
    const guarded = applyDataUrlGuard(event, 10);
    const childNodes = (
      guarded.data as { node: { childNodes: Array<{ attributes: { src: string } }> } }
    ).node.childNodes;
    expect(childNodes[0]?.attributes.src).toBe(longHttp);
  });

  test('does not mutate the input event', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(50)}`;
    const event = makeFullSnapshot(oversized);
    applyDataUrlGuard(event, 10);
    const childNodes = (
      event.data as { node: { childNodes: Array<{ attributes: { src: string } }> } }
    ).node.childNodes;
    expect(childNodes[0]?.attributes.src).toBe(oversized);
  });
});

describe('applyDataUrlGuard — IncrementalSnapshot mutation adds', () => {
  test('replaces an oversized data: URL on an added node', () => {
    const oversized = `data:image/png;base64,${'B'.repeat(50)}`;
    const event: eventWithTime = {
      type: EventType.IncrementalSnapshot,
      timestamp: 4_000,
      data: {
        source: IncrementalSource.Mutation,
        texts: [],
        attributes: [],
        removes: [],
        adds: [
          {
            parentId: 1,
            nextId: null,
            node: {
              type: 2,
              id: 200,
              tagName: 'img',
              attributes: { src: oversized },
              childNodes: [],
            },
          },
        ],
      },
    } as unknown as eventWithTime;

    const guarded = applyDataUrlGuard(event, 10);
    const adds = (guarded.data as { adds: Array<{ node: { attributes: { src: string } } }> }).adds;
    expect(adds[0]?.node.attributes.src).toBe(DATA_URL_PLACEHOLDER);
  });

  test('ignores non-mutation incremental events', () => {
    const event = makeNonMutationIncremental();
    const guarded = applyDataUrlGuard(event, 10);
    expect(guarded).toBe(event);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyEventSizeGuard
// ────────────────────────────────────────────────────────────────────────────

describe('applyEventSizeGuard', () => {
  test('preserves an event under the size cap', () => {
    const event = makeNonMutationIncremental();
    let dropped: customEvent | null = null;
    const result = applyEventSizeGuard(event, 1024, (e) => {
      dropped = e;
    });
    expect(result).toBe(event);
    expect(dropped).toBeNull();
  });

  test('drops an event over the cap and emits the dropped breadcrumb', () => {
    const huge = makeMutationEvent(2_000); // serializes to lots of JSON
    let breadcrumb: customEvent | null = null;
    const result = applyEventSizeGuard(huge, 100, (e) => {
      breadcrumb = e;
    });
    expect(result).toBeNull();
    expect(breadcrumb).not.toBeNull();
    const b = breadcrumb as unknown as customEvent<{ type: number; ts: number; size: number }>;
    expect(b.data.tag).toBe('tracelane.event.dropped');
    expect(b.data.payload.type).toBe(EventType.IncrementalSnapshot);
    expect(b.data.payload.size).toBeGreaterThan(100);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Ordering: dataUrl → eventSize → mutation
// ────────────────────────────────────────────────────────────────────────────

describe('applyLargeDomGuards — guard ordering (dataUrl before eventSize)', () => {
  test('an oversized data: URL gets substituted before the event-size cap is measured', () => {
    // Build a FullSnapshot whose only big payload is one oversized data URL.
    // If event-size ran first, the WHOLE event would be dropped (the data URL
    // alone is ~5x the cap). If data-URL runs first, the placeholder shrinks
    // the event well under the cap, so the event survives.
    const oversizedDataUrl = `data:image/png;base64,${'X'.repeat(50_000)}`;
    const event = makeFullSnapshot(oversizedDataUrl);

    const forwarded: eventWithTime[] = [];
    const breadcrumbs: customEvent[] = [];
    const options = applyLargeDomGuards(
      { emit: (e) => forwarded.push(e) },
      {
        defaults: {
          ...LARGE_DOM_DEFAULTS,
          dataUrlMaxBytes: 100, // very small for testing
          singleEventMaxBytes: 5_000, // smaller than the original oversized data URL
        },
        onWarn: (e) => breadcrumbs.push(e),
      },
    );

    options.emit?.(event);

    expect(forwarded.length).toBe(1);
    expect(breadcrumbs.length).toBe(0); // event NOT dropped — proves order is dataUrl → eventSize
    const childNodes = (
      forwarded[0]?.data as { node: { childNodes: Array<{ attributes: { src: string } }> } }
    ).node.childNodes;
    expect(childNodes[0]?.attributes.src).toBe(DATA_URL_PLACEHOLDER);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyLargeDomGuards — end-to-end smoke
// ────────────────────────────────────────────────────────────────────────────

describe('applyLargeDomGuards — end-to-end', () => {
  test('forwards under-cap, non-mutation events untouched', () => {
    const forwarded: eventWithTime[] = [];
    const options = applyLargeDomGuards({ emit: (e) => forwarded.push(e) });
    const event = makeNonMutationIncremental();
    options.emit?.(event);
    expect(forwarded.length).toBe(1);
    expect(forwarded[0]?.type).toBe(EventType.IncrementalSnapshot);
  });

  test('routes the soft-warn breadcrumb to onWarn', () => {
    const warns: customEvent[] = [];
    const options = applyLargeDomGuards({ emit: () => {} }, { onWarn: (e) => warns.push(e) });
    options.emit?.(makeMutationEvent(800));
    expect(warns.some((w) => w.data.tag === 'tracelane.mutation.warn')).toBe(true);
  });

  test('fires onLimit and routes the limit breadcrumb to onWarn', () => {
    let limitFired = 0;
    const warns: customEvent[] = [];
    const options = applyLargeDomGuards(
      { emit: () => {} },
      {
        defaults: { ...LARGE_DOM_DEFAULTS, mutationLimit: 100, mutationSoftWarnAt: 50 },
        onWarn: (e) => warns.push(e),
        onLimit: () => limitFired++,
      },
    );
    options.emit?.(makeMutationEvent(200));
    expect(limitFired).toBe(1);
    expect(warns.some((w) => w.data.tag === 'tracelane.mutation.limit')).toBe(true);
  });
});
