import { EventType } from '@cubenest/rrweb-core';
import type { eventWithTime } from '@cubenest/rrweb-core';

/**
 * Hard cap on the serialized events size (ADR-0005): 25 MB. Calibrated against
 * GitHub Actions artifact limits and rrweb's typical compressed size for
 * ~5-minute interactive tests; anything larger is slow to open in a browser.
 */
export const MAX_REPORT_BYTES = 25 * 1024 * 1024;

/** Tag of the custom rrweb event emitted when a prune fires (ADR-0005). */
export const PRUNE_EVENT_TAG = 'tracelane.events-pruned';

/**
 * Event types that must survive a prune (ADR-0005): FullSnapshot checkpoints
 * are mandatory for replay, and Meta / Custom / Plugin carry structural and
 * panel context. Only IncrementalSnapshot (the largest, lowest-value-per-byte
 * category) is droppable.
 */
const PRESERVED_TYPES: ReadonlySet<EventType> = new Set([
  EventType.FullSnapshot, // 2
  EventType.Meta, // 4
  EventType.Custom, // 5
  EventType.Plugin, // 6
]);

const encoder = new TextEncoder();

/** UTF-8 byte length of the JSON serialization of `events`. */
export function serializedSize(events: readonly eventWithTime[]): number {
  return encoder.encode(JSON.stringify(events)).length;
}

/** Payload of the {@link PRUNE_EVENT_TAG} marker. */
export interface PruneEventPayload {
  /** Number of IncrementalSnapshot events dropped to fit the budget. */
  droppedCount: number;
  /** The byte budget the prune targeted. */
  maxBytes: number;
}

export interface PruneResult {
  /** The (possibly pruned) events, including the prune marker when fired. */
  events: eventWithTime[];
  /** Whether any events were dropped. */
  pruned: boolean;
  /** How many IncrementalSnapshot events were dropped. */
  droppedCount: number;
}

function makePruneEvent(payload: PruneEventPayload): eventWithTime {
  return {
    type: EventType.Custom,
    data: { tag: PRUNE_EVENT_TAG, payload },
    timestamp: Date.now(),
  } as unknown as eventWithTime;
}

/**
 * Prune `events` to fit `maxBytes` (ADR-0005), dropping the OLDEST
 * IncrementalSnapshot (type 3) events first while preserving FullSnapshot /
 * Meta / Custom / Plugin. Surviving events keep their relative order. When any
 * event is dropped, a single {@link PRUNE_EVENT_TAG} custom event is appended
 * so the report can surface a "events pruned to fit budget" banner.
 *
 * If dropping every IncrementalSnapshot still doesn't fit (preserved events
 * alone exceed the budget), it keeps the preserved events — replay correctness
 * wins over the byte cap, and the prune marker still records what happened.
 */
export function pruneToSizeBudget(
  events: readonly eventWithTime[],
  maxBytes: number = MAX_REPORT_BYTES,
): PruneResult {
  if (serializedSize(events) <= maxBytes) {
    return { events: [...events], pruned: false, droppedCount: 0 };
  }

  // Indices of droppable (IncrementalSnapshot) events, oldest first. The input
  // is already in chronological order, so array order == chronological order.
  const droppableIndices: number[] = [];
  events.forEach((e, i) => {
    if (!PRESERVED_TYPES.has(e.type)) droppableIndices.push(i);
  });

  const dropped = new Set<number>();
  for (const index of droppableIndices) {
    if (serializedSize(events.filter((_, i) => !dropped.has(i))) <= maxBytes) break;
    dropped.add(index);
  }

  const droppedCount = dropped.size;
  const survivors = events.filter((_, i) => !dropped.has(i));

  if (droppedCount === 0) {
    return { events: survivors, pruned: false, droppedCount: 0 };
  }

  survivors.push(makePruneEvent({ droppedCount, maxBytes }));
  return { events: survivors, pruned: true, droppedCount };
}
