// Guard implementations — Task 1.4.
//
// Three pure-ish guards, applied in this order by `applyLargeDomGuards`:
//
//   1. `applyDataUrlGuard`   — substitutes oversized data:URL attributes
//   2. `applyEventSizeGuard` — drops events whose JSON payload exceeds the
//                              configured cap
//   3. `applyMutationGuard`  — stateful counter wrapping the emit callback;
//                              warns above the soft threshold, halts above
//                              the hard limit
//
// Guards 1 and 2 are pure transforms (return a new event or null). Guard 3
// is a higher-order function that returns a wrapped emitter — the only
// stateful guard, because per-batch + cumulative counters need persistence
// across calls.
//
// None of the guards mutate their input events; they return new objects
// (shallow + relevant nested clone) so the caller's references stay clean.

import { EventType, IncrementalSource } from '../rrweb.js';
import type { customEvent, eventWithTime } from '../rrweb.js';

// ────────────────────────────────────────────────────────────────────────────
// Data-URL placeholder
// ────────────────────────────────────────────────────────────────────────────

/**
 * 1×1 transparent SVG carrying the text marker `CUBENEST-DATA-URL-OVERSIZE`.
 * Base64-encoded so the resulting `data:image/svg+xml;base64,...` URL is
 * compact and replays without parse warnings in modern browsers.
 *
 * Source SVG (pre-base64):
 *   <svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">
 *     <text>CUBENEST-DATA-URL-OVERSIZE</text>
 *   </svg>
 *
 * Substituted by `applyDataUrlGuard` when a data: URL exceeds the configured
 * `dataUrlMaxBytes`. Kept here as a frozen constant so test fixtures and
 * downstream tooling can identify oversize hits by exact-match.
 */
export const DATA_URL_PLACEHOLDER =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjx0ZXh0PkNVQkVORVNULURBVEEtVVJMLU9WRVJTSVpFPC90ZXh0Pjwvc3ZnPg==';

const DATA_URL_PREFIX = /^data:/;

// ────────────────────────────────────────────────────────────────────────────
// Internal node walker — used by the data-URL guard.
// ────────────────────────────────────────────────────────────────────────────

// rrweb's `serializedNode` shape leans heavily on indexed-record `attributes`
// maps. We type-guard at runtime rather than narrow to the imported types
// because the imported types are deeply recursive (`childNodes` of unions of
// unions) and TypeScript's generic narrowing inside the walker rapidly
// degrades into `any`. Keeping the walker permissive but well-tested is the
// pragmatic call.
type AnyRecord = Record<string, unknown>;
type AnyNode = AnyRecord & { childNodes?: AnyNode[]; attributes?: AnyRecord };

function isObject(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null;
}

/**
 * Walks a serialized node and its `childNodes` recursively, replacing any
 * `src`/`href` attribute whose value is a data: URL longer than `maxBytes`
 * with the SVG placeholder. Returns a deeply-cloned node — input is not
 * mutated.
 */
function walkAndGuardNode(node: AnyNode, maxBytes: number): AnyNode {
  const clone: AnyNode = { ...node };

  if (isObject(node.attributes)) {
    const attrs: AnyRecord = { ...node.attributes };
    for (const key of ['src', 'href']) {
      const value = attrs[key];
      if (typeof value === 'string' && DATA_URL_PREFIX.test(value) && value.length > maxBytes) {
        attrs[key] = DATA_URL_PLACEHOLDER;
      }
    }
    clone.attributes = attrs;
  }

  if (Array.isArray(node.childNodes)) {
    clone.childNodes = node.childNodes.map((child) =>
      isObject(child) ? walkAndGuardNode(child as AnyNode, maxBytes) : child,
    );
  }

  return clone;
}

// ────────────────────────────────────────────────────────────────────────────
// Data-URL guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Replaces oversized data: URLs in either:
 *   - a FullSnapshot event's tree (`data.node`), or
 *   - an IncrementalSnapshot.Mutation event's `adds` array (each `node`).
 *
 * Non-snapshot events are returned unchanged. Small data URLs and non-data
 * URLs are preserved verbatim. The original event is never mutated.
 */
export function applyDataUrlGuard(event: eventWithTime, maxBytes: number): eventWithTime {
  if (event.type === EventType.FullSnapshot) {
    const data = event.data as { node: AnyNode; initialOffset: AnyRecord };
    if (!isObject(data) || !isObject(data.node)) return event;
    return {
      ...event,
      data: {
        ...data,
        node: walkAndGuardNode(data.node, maxBytes),
      },
    } as eventWithTime;
  }

  if (event.type === EventType.IncrementalSnapshot) {
    const data = event.data as { source?: number; adds?: Array<{ node: AnyNode } & AnyRecord> };
    if (!isObject(data) || data.source !== IncrementalSource.Mutation) return event;
    if (!Array.isArray(data.adds) || data.adds.length === 0) return event;

    const adds = data.adds.map((entry) => {
      if (!isObject(entry) || !isObject(entry.node)) return entry;
      return { ...entry, node: walkAndGuardNode(entry.node as AnyNode, maxBytes) };
    });

    return {
      ...event,
      data: { ...data, adds },
    } as eventWithTime;
  }

  return event;
}

// ────────────────────────────────────────────────────────────────────────────
// Event-size guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Drops events whose JSON-stringified size exceeds `maxBytes`.
 *
 * When dropping, the guard emits a sibling `tracelane.event.dropped` custom
 * event via `onDrop` (so the consumer can forward it). The dropped breadcrumb
 * carries `{ type, ts, size }` — enough for postmortem reasoning without
 * leaking the dropped event's payload. Returns `null` when the input is
 * dropped, otherwise returns the input unchanged.
 *
 * Size is measured via `JSON.stringify().length` (UTF-16 code units), which
 * is a close-enough proxy for transport bytes at this layer.
 */
export function applyEventSizeGuard(
  event: eventWithTime,
  maxBytes: number,
  onDrop: (
    breadcrumb: customEvent<{ type: number; ts: number; size: number }> & {
      timestamp: number;
    },
  ) => void,
): eventWithTime | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(event);
  } catch {
    // Circular reference or BigInt — defensively drop. Same breadcrumb shape.
    onDrop({
      type: EventType.Custom,
      data: {
        tag: 'tracelane.event.dropped',
        payload: { type: event.type, ts: event.timestamp, size: -1 },
      },
      timestamp: event.timestamp,
    });
    return null;
  }

  if (serialized.length <= maxBytes) return event;

  onDrop({
    type: EventType.Custom,
    data: {
      tag: 'tracelane.event.dropped',
      payload: { type: event.type, ts: event.timestamp, size: serialized.length },
    },
    timestamp: event.timestamp,
  });
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Mutation guard
// ────────────────────────────────────────────────────────────────────────────

/**
 * Counts the mutations in an IncrementalSnapshot.Mutation batch. Sums
 * texts + attributes + removes + adds. Non-mutation events return 0.
 */
function countMutationsInEvent(event: eventWithTime): number {
  if (event.type !== EventType.IncrementalSnapshot) return 0;
  const data = event.data as {
    source?: number;
    texts?: unknown[];
    attributes?: unknown[];
    removes?: unknown[];
    adds?: unknown[];
  };
  if (!isObject(data) || data.source !== IncrementalSource.Mutation) return 0;
  return (
    (Array.isArray(data.texts) ? data.texts.length : 0) +
    (Array.isArray(data.attributes) ? data.attributes.length : 0) +
    (Array.isArray(data.removes) ? data.removes.length : 0) +
    (Array.isArray(data.adds) ? data.adds.length : 0)
  );
}

/**
 * Hooks supplied to `applyMutationGuard`. The guard fires `onWarn` at most
 * once per batch (when batch count > soft threshold), and `onLimit` at most
 * once per recording (when cumulative count > hard limit). After `onLimit`,
 * the wrapped emit is a no-op — consumers should call rrweb's teardown from
 * `onLimit` to truly stop the recorder.
 */
export interface MutationGuardHooks {
  softWarnAt: number;
  hardLimit: number;
  emitWarn: (event: customEvent & { timestamp: number }) => void;
  emitLimit: (event: customEvent & { timestamp: number }) => void;
  onLimit?: () => void;
}

/**
 * Wraps an `emit` callback with the cumulative + per-batch mutation counters.
 * Returns a new emit function with the same signature; the wrapper is
 * stateful (closure-captured counters).
 */
export function applyMutationGuard(
  emit: (event: eventWithTime, isCheckout?: boolean) => void,
  hooks: MutationGuardHooks,
): (event: eventWithTime, isCheckout?: boolean) => void {
  let cumulative = 0;
  let limitReached = false;

  return (event: eventWithTime, isCheckout?: boolean): void => {
    if (limitReached) return;

    const batchCount = countMutationsInEvent(event);

    if (batchCount > hooks.softWarnAt) {
      const warn: customEvent<{ count: number; batchTs: number }> & { timestamp: number } = {
        type: EventType.Custom,
        data: {
          tag: 'tracelane.mutation.warn',
          payload: { count: batchCount, batchTs: event.timestamp },
        },
        timestamp: event.timestamp,
      };
      hooks.emitWarn(warn);
    }

    cumulative += batchCount;

    if (cumulative > hooks.hardLimit) {
      limitReached = true;
      const limitEvent: customEvent<{ totalCount: number }> & { timestamp: number } = {
        type: EventType.Custom,
        data: {
          tag: 'tracelane.mutation.limit',
          payload: { totalCount: cumulative },
        },
        timestamp: event.timestamp,
      };
      hooks.emitLimit(limitEvent);
      hooks.onLimit?.();
      // Drop the offending event itself — the limit breadcrumb is the final
      // signal forwarded for this recording.
      return;
    }

    emit(event, isCheckout);
  };
}
