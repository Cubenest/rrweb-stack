// Compression helpers — Task 1.9 test suite.
//
// Coverage groups:
//   1. Round-trip identity — small fixture, empty array, 1 MB fixture.
//   2. Compression ratio sanity — repetitive rrweb-like payloads must
//      crush under gzip; we pin <50% as a regression canary.
//   3. Input validation — TypeError on non-array compress, non-Uint8Array
//      decompress, payload that doesn't deserialize to an array.
//   4. Malformed gzip — random bytes throw at the inflate boundary.
//
// We hand-build `eventWithTime` fixtures to keep the suite hermetic (no
// rrweb recorder bootstrap). Per ADR-0002 the compression API is two
// thin functions over fflate — the test surface mirrors that minimalism.

import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, test } from 'vitest';
import { compress, decompress } from '../src/compression';
import { EventType, IncrementalSource } from '../src/rrweb';
import type { eventWithTime } from '../src/rrweb';

// ────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a synthetic mutation event with `nMutations` adds. The shape is
 * intentionally close to what rrweb's `Mutation` source emits so the gzip
 * dictionary sees realistic repetition (`type`, `tagName`, `attributes`).
 */
function buildMutationEvent(timestamp: number, nMutations: number): eventWithTime {
  const adds: Array<unknown> = [];
  for (let i = 0; i < nMutations; i++) {
    adds.push({
      parentId: 1,
      nextId: null,
      node: {
        type: 2,
        tagName: 'div',
        attributes: { class: `row row-${i % 16}`, 'data-index': String(i) },
        childNodes: [
          {
            type: 3,
            textContent: `cell-${i}`,
            id: 1000 + i * 2,
          },
        ],
        id: 1000 + i * 2 + 1,
      },
    });
  }
  return {
    type: EventType.IncrementalSnapshot,
    timestamp,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds,
    },
  } as unknown as eventWithTime;
}

/**
 * Build a synthetic event array whose `JSON.stringify` size exceeds
 * `minBytes`. Returns the array AND its JSON byte length so tests can
 * assert the ratio against a known denominator.
 */
function buildLargeFixture(minBytes: number): { events: eventWithTime[]; jsonBytes: number } {
  const events: eventWithTime[] = [];
  let ts = 1_000_000;
  // 50 mutations per event ≈ ~5 KB JSON; ~200 events ≈ ~1 MB.
  // Keep going until we cross the threshold — exact count depends on
  // JSON.stringify spacing, so we measure as we go.
  while (true) {
    events.push(buildMutationEvent(ts, 50));
    ts += 16;
    if (events.length % 50 === 0) {
      // Cheap progress check — re-serialize only every 50 events to
      // avoid quadratic blow-up on stringify.
      const size = JSON.stringify(events).length;
      if (size > minBytes) {
        return { events, jsonBytes: size };
      }
    }
    // Defensive ceiling — should never hit in practice.
    if (events.length > 100_000) {
      throw new Error('buildLargeFixture: could not reach target size');
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Round-trip identity
// ────────────────────────────────────────────────────────────────────────────

describe('compress / decompress — round-trip identity', () => {
  test('small fixture round-trips to deep equality', () => {
    const events: eventWithTime[] = [
      { type: 4, data: { href: 'x' }, timestamp: 1 } as unknown as eventWithTime,
    ];
    const bytes = compress(events);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const restored = decompress(bytes);
    expect(restored).toEqual(events);
  });

  test('empty array round-trips to empty array', () => {
    const bytes = compress([]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0); // gzip frame has non-zero overhead
    const restored = decompress(bytes);
    expect(restored).toEqual([]);
  });

  test('~1 MB synthetic fixture round-trips to deep equality', () => {
    const { events, jsonBytes } = buildLargeFixture(1_000_000);
    expect(jsonBytes).toBeGreaterThan(1_000_000);
    const bytes = compress(events);
    const restored = decompress(bytes);
    expect(restored).toEqual(events);
    expect(restored.length).toBe(events.length);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Compression ratio sanity
// ────────────────────────────────────────────────────────────────────────────

describe('compress — ratio sanity', () => {
  test('1 MB synthetic fixture compresses to under 50% of JSON size', () => {
    const { events, jsonBytes } = buildLargeFixture(1_000_000);
    const compressed = compress(events);
    const ratio = compressed.length / jsonBytes;
    // Repetitive rrweb-shaped JSON crushes under gzip; <50% is a generous
    // canary. In practice we observe well under 10% on this fixture — if
    // this assertion ever fails, something is wrong (e.g. payload became
    // accidentally non-repetitive, or fflate level changed unexpectedly).
    expect(ratio).toBeLessThan(0.5);
    // Bound from below too — gzip overhead means even an empty payload is
    // non-zero, but anything truly tiny would mean the input was empty.
    expect(compressed.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Input validation
// ────────────────────────────────────────────────────────────────────────────

describe('compress — input validation', () => {
  test('throws TypeError on string input', () => {
    expect(() => compress('not-an-array' as unknown as eventWithTime[])).toThrow(TypeError);
    expect(() => compress('not-an-array' as unknown as eventWithTime[])).toThrow(
      /must be an array/,
    );
  });

  test('throws TypeError on null input', () => {
    expect(() => compress(null as unknown as eventWithTime[])).toThrow(TypeError);
  });

  test('throws TypeError on plain-object input', () => {
    expect(() => compress({ length: 0 } as unknown as eventWithTime[])).toThrow(TypeError);
  });
});

describe('decompress — input validation', () => {
  test('throws TypeError on plain-array input', () => {
    expect(() => decompress([] as unknown as Uint8Array)).toThrow(TypeError);
    expect(() => decompress([] as unknown as Uint8Array)).toThrow(/must be a Uint8Array/);
  });

  test('throws TypeError on string input', () => {
    expect(() => decompress('bytes' as unknown as Uint8Array)).toThrow(TypeError);
  });

  test('throws on malformed gzip bytes', () => {
    // Three random bytes — not a valid gzip frame. fflate raises its own
    // error; we just assert SOMETHING throws (not a TypeError specifically,
    // since fflate's errors aren't TypeErrors).
    expect(() => decompress(new Uint8Array([1, 2, 3]))).toThrow();
  });

  test('throws TypeError when inflated payload is not a JSON array', () => {
    // Manually craft a gzipped JSON OBJECT (not an array). This is the
    // "downstream surprise" guard — if a caller hand-gzips a payload of
    // the wrong shape and feeds it to decompress, we want a clear error
    // at the boundary instead of returning an object cast to the array
    // type and crashing further upstream.
    const bogus = gzipSync(strToU8('{"x":1}'));
    expect(() => decompress(bogus)).toThrow(TypeError);
    expect(() => decompress(bogus)).toThrow(/did not deserialize to an array/);
  });
});
