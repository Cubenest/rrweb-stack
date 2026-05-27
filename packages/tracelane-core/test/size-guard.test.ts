import { EventType } from '@cubenest/rrweb-core';
import type { customEvent, eventWithTime } from '@cubenest/rrweb-core';
import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_BYTES,
  PRUNE_EVENT_TAG,
  pruneToSizeBudget,
  serializedSize,
} from '../src/size-guard';

function evt(type: EventType, ts: number, padBytes = 0): eventWithTime {
  return {
    type,
    data: padBytes > 0 ? { pad: 'x'.repeat(padBytes) } : {},
    timestamp: ts,
  } as unknown as eventWithTime;
}

function isPruneEvent(e: eventWithTime): e is customEvent & eventWithTime {
  return e.type === EventType.Custom && (e as customEvent).data.tag === PRUNE_EVENT_TAG;
}

describe('size guard constants (ADR-0005)', () => {
  it('caps reports at 25 MB', () => {
    expect(MAX_REPORT_BYTES).toBe(25 * 1024 * 1024);
  });

  it('serializedSize returns the UTF-8 byte length of the JSON', () => {
    const events = [evt(EventType.Meta, 1)];
    expect(serializedSize(events)).toBe(Buffer.byteLength(JSON.stringify(events), 'utf8'));
  });
});

describe('pruneToSizeBudget: FullSnapshot-preserving prune (ADR-0005)', () => {
  it('returns events unchanged and pruned:false when under budget', () => {
    const events = [evt(EventType.Meta, 1), evt(EventType.FullSnapshot, 2)];
    const result = pruneToSizeBudget(events, MAX_REPORT_BYTES);
    expect(result.pruned).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.events).toHaveLength(2);
  });

  it('drops oldest IncrementalSnapshot (type 3) events first when over budget', () => {
    // Three fat incremental snapshots + structural events; tiny budget forces prune.
    const events: eventWithTime[] = [
      evt(EventType.Meta, 1),
      evt(EventType.FullSnapshot, 2, 500),
      evt(EventType.IncrementalSnapshot, 3, 2000), // oldest incremental
      evt(EventType.IncrementalSnapshot, 4, 2000),
      evt(EventType.IncrementalSnapshot, 5, 2000), // newest incremental
    ];
    const budget = serializedSize(events) - 3000; // must drop ~2 incrementals
    const result = pruneToSizeBudget(events, budget);

    expect(result.pruned).toBe(true);
    const remainingIncrementals = result.events.filter(
      (e) => e.type === EventType.IncrementalSnapshot,
    );
    // The newest incremental (ts=5) survives; the oldest (ts=3) is dropped first.
    expect(remainingIncrementals.some((e) => e.timestamp === 5)).toBe(true);
    expect(remainingIncrementals.some((e) => e.timestamp === 3)).toBe(false);
  });

  it('never drops FullSnapshot(2)/Meta(4)/Custom(5)/Plugin(6) events', () => {
    const events: eventWithTime[] = [
      evt(EventType.Meta, 1, 5000),
      evt(EventType.FullSnapshot, 2, 5000),
      evt(EventType.Custom, 3, 5000),
      evt(EventType.Plugin, 4, 5000),
      evt(EventType.IncrementalSnapshot, 5, 5000),
    ];
    // Budget so tight even dropping the single incremental can't satisfy it.
    const result = pruneToSizeBudget(events, 100);

    const types = result.events.map((e) => e.type);
    expect(types).toContain(EventType.Meta);
    expect(types).toContain(EventType.FullSnapshot);
    expect(types).toContain(EventType.Custom);
    expect(types).toContain(EventType.Plugin);
    // The only incremental was dropped.
    expect(types).not.toContain(EventType.IncrementalSnapshot);
  });

  it('appends a single tracelane.events-pruned custom event when prune fires', () => {
    const events: eventWithTime[] = [
      evt(EventType.FullSnapshot, 1, 1000),
      evt(EventType.IncrementalSnapshot, 2, 4000),
      evt(EventType.IncrementalSnapshot, 3, 4000),
    ];
    const budget = serializedSize(events) - 4000;
    const result = pruneToSizeBudget(events, budget);

    const pruneEvents = result.events.filter(isPruneEvent);
    expect(pruneEvents).toHaveLength(1);
    const payload = (pruneEvents[0] as customEvent<{ droppedCount: number }>).data.payload;
    expect(payload.droppedCount).toBeGreaterThan(0);
    expect(payload.droppedCount).toBe(result.droppedCount);
  });

  it('does NOT append a prune event when nothing is dropped', () => {
    const events = [evt(EventType.FullSnapshot, 1)];
    const result = pruneToSizeBudget(events, MAX_REPORT_BYTES);
    expect(result.events.filter(isPruneEvent)).toHaveLength(0);
  });

  it('preserves relative order of surviving events', () => {
    const events: eventWithTime[] = [
      evt(EventType.Meta, 1),
      evt(EventType.IncrementalSnapshot, 2, 3000),
      evt(EventType.FullSnapshot, 3),
      evt(EventType.IncrementalSnapshot, 4, 10),
      evt(EventType.Custom, 5),
    ];
    const budget = serializedSize(events) - 2000;
    const result = pruneToSizeBudget(events, budget);

    // Drop the prune marker for the ordering check.
    const survivors = result.events.filter((e) => !isPruneEvent(e));
    const timestamps = survivors.map((e) => e.timestamp);
    const sorted = [...timestamps].sort((a, b) => a - b);
    expect(timestamps).toEqual(sorted);
  });
});
