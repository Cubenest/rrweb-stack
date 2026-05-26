// Console capture buffer — Task 1.8 test suite.
//
// Coverage groups:
//   1. Wiring — the plugin field is populated and the buffer factory does
//      not throw under default or custom options.
//   2. push() event filtering — only `EventType.Plugin` events with the
//      `rrweb/console@1` plugin name are buffered; everything else is
//      silently ignored.
//   3. push() normalization — vendor `LogData` shape
//      (`{ level, trace, payload: string[] }`) becomes our `ConsoleEvent`
//      shape (`{ ts, level, args, trace? }`) with the args array
//      renamed and the surrounding rrweb timestamp lifted in.
//   4. drain() vs peek() semantics — drain empties, peek snapshots.
//   5. FIFO eviction at `maxBuffered`.
//   6. Recursion guard — push() of a malformed payload must NOT touch
//      `console.*`. This is the load-bearing safety contract (P1 PRD §D.4).
//
// The plugin's runtime behavior (level filtering, stringify) is tested
// upstream — we only verify the wiring + buffer semantics. We hand-build
// `eventWithTime` fixtures to keep the suite hermetic.

import { describe, expect, test, vi } from 'vitest';
import {
  type ConsoleCaptureBuffer,
  type ConsoleEvent,
  createConsoleCaptureBuffer,
} from '../src/console';
import { EventType } from '../src/rrweb';
import type { eventWithTime } from '../src/rrweb';

// ────────────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a structurally-valid `eventWithTime` for a console-record plugin
 * emission. Mirrors what rrweb's `wrappedEmit` actually produces — the
 * outer event has `type: 6, timestamp`, and the inner data carries the
 * plugin name + the plugin's `LogData` payload.
 */
function buildConsolePluginEvent(
  timestamp: number,
  payload: { level: string; trace: string[]; payload: string[] },
): eventWithTime {
  // Cast through unknown because the plugin event type uses generic
  // `payload: T` and we're constructing an unspecialized variant.
  return {
    type: EventType.Plugin,
    timestamp,
    data: {
      plugin: 'rrweb/console@1',
      payload,
    },
  } as unknown as eventWithTime;
}

/** Build a non-console plugin event (e.g. a different plugin name). */
function buildOtherPluginEvent(timestamp: number, pluginName: string): eventWithTime {
  return {
    type: EventType.Plugin,
    timestamp,
    data: { plugin: pluginName, payload: { whatever: true } },
  } as unknown as eventWithTime;
}

/** Build a non-plugin event (e.g. a FullSnapshot). */
function buildFullSnapshotEvent(timestamp: number): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    timestamp,
    data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { left: 0, top: 0 } },
  } as unknown as eventWithTime;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Wiring
// ────────────────────────────────────────────────────────────────────────────

describe('createConsoleCaptureBuffer — wiring', () => {
  test('returns a plugin object that rrweb can register', () => {
    const buf = createConsoleCaptureBuffer();
    expect(buf.plugin).not.toBeNull();
    expect(typeof buf.plugin).toBe('object');
    // RecordPlugin shape: `{ name, observer, options? }`. We assert on
    // `name` because that's what rrweb uses as the plugin discriminator
    // in emitted events (`event.data.plugin`).
    expect((buf.plugin as { name?: string }).name).toBe('rrweb/console@1');
  });

  test('default options do not throw', () => {
    expect(() => createConsoleCaptureBuffer()).not.toThrow();
  });

  test('custom options do not throw', () => {
    expect(() =>
      createConsoleCaptureBuffer({
        level: ['warn', 'error'],
        lengthThreshold: 50,
        stringifyOptions: {
          stringLengthLimit: 200,
          numOfKeysLimit: 10,
          depthOfLimit: 2,
        },
        maxBuffered: 100,
      }),
    ).not.toThrow();
  });

  test('initial buffer size is zero', () => {
    const buf = createConsoleCaptureBuffer();
    expect(buf.size()).toBe(0);
    expect(buf.peek()).toEqual([]);
    expect(buf.drain()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. push() — event filtering
// ────────────────────────────────────────────────────────────────────────────

describe('push() — filtering', () => {
  test('console plugin event is buffered', () => {
    const buf = createConsoleCaptureBuffer();
    buf.push(
      buildConsolePluginEvent(1000, {
        level: 'error',
        trace: ['at foo:1'],
        payload: ['something broke'],
      }),
    );
    expect(buf.size()).toBe(1);
  });

  test('FullSnapshot (type=2) is ignored', () => {
    const buf = createConsoleCaptureBuffer();
    buf.push(buildFullSnapshotEvent(1000));
    expect(buf.size()).toBe(0);
  });

  test('Plugin event from a different plugin name is ignored', () => {
    const buf = createConsoleCaptureBuffer();
    buf.push(buildOtherPluginEvent(1000, 'rrweb/network@1'));
    buf.push(buildOtherPluginEvent(2000, 'some-other-plugin'));
    expect(buf.size()).toBe(0);
  });

  test('IncrementalSnapshot (type=3) is ignored', () => {
    const buf = createConsoleCaptureBuffer();
    const event: eventWithTime = {
      type: EventType.IncrementalSnapshot,
      timestamp: 1000,
      data: { source: 0, texts: [], attributes: [], removes: [], adds: [] },
    } as unknown as eventWithTime;
    buf.push(event);
    expect(buf.size()).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. push() — normalization
// ────────────────────────────────────────────────────────────────────────────

describe('push() — normalization', () => {
  test('error event with trace is normalized to ConsoleEvent', () => {
    const buf = createConsoleCaptureBuffer();
    buf.push(
      buildConsolePluginEvent(1234, {
        level: 'error',
        trace: ['at foo:1', 'at bar:2'],
        payload: ['something broke', 'extra arg'],
      }),
    );
    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.ts).toBe(1234);
    expect(drained[0]?.level).toBe('error');
    expect(drained[0]?.args).toEqual(['something broke', 'extra arg']);
    expect(drained[0]?.trace).toEqual(['at foo:1', 'at bar:2']);
  });

  test('plugin event with empty trace omits the trace field (no signal)', () => {
    const buf = createConsoleCaptureBuffer();
    buf.push(
      buildConsolePluginEvent(5000, {
        level: 'log',
        trace: [],
        payload: ['hello'],
      }),
    );
    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.trace).toBeUndefined();
  });

  test('args array is copied (mutating the source does not affect buffered event)', () => {
    const buf = createConsoleCaptureBuffer();
    const sourcePayload = ['a', 'b'];
    buf.push(
      buildConsolePluginEvent(1, {
        level: 'log',
        trace: [],
        payload: sourcePayload,
      }),
    );
    sourcePayload.push('c'); // Mutate AFTER push.
    const drained = buf.drain();
    expect(drained[0]?.args).toEqual(['a', 'b']);
  });

  test('all six common log levels round-trip through the buffer', () => {
    const buf = createConsoleCaptureBuffer();
    const levels = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i];
      if (lvl === undefined) continue; // type narrowing for biome
      buf.push(
        buildConsolePluginEvent(i, {
          level: lvl,
          trace: [],
          payload: [`msg-${lvl}`],
        }),
      );
    }
    const drained = buf.drain();
    expect(drained.map((e) => e.level)).toEqual([...levels]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. drain() vs peek()
// ────────────────────────────────────────────────────────────────────────────

describe('drain() vs peek()', () => {
  function fill(buf: ConsoleCaptureBuffer, n: number): void {
    for (let i = 0; i < n; i++) {
      buf.push(
        buildConsolePluginEvent(i, {
          level: 'log',
          trace: [],
          payload: [`msg-${i}`],
        }),
      );
    }
  }

  test('peek() returns a snapshot without emptying', () => {
    const buf = createConsoleCaptureBuffer();
    fill(buf, 3);
    const snapshot = buf.peek();
    expect(snapshot).toHaveLength(3);
    expect(buf.size()).toBe(3);
    // Second peek still returns the same data.
    expect(buf.peek()).toHaveLength(3);
  });

  test('peek() returns a copy — pushing afterward does not mutate the snapshot', () => {
    const buf = createConsoleCaptureBuffer();
    fill(buf, 2);
    const snapshot = buf.peek();
    expect(snapshot).toHaveLength(2);
    fill(buf, 1);
    expect(snapshot).toHaveLength(2);
    expect(buf.size()).toBe(3);
  });

  test('drain() returns and empties', () => {
    const buf = createConsoleCaptureBuffer();
    fill(buf, 4);
    const drained = buf.drain();
    expect(drained).toHaveLength(4);
    expect(buf.size()).toBe(0);
    expect(buf.peek()).toEqual([]);
    // Second drain is empty.
    expect(buf.drain()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. FIFO eviction
// ────────────────────────────────────────────────────────────────────────────

describe('maxBuffered FIFO eviction', () => {
  test('exceeding maxBuffered drops the OLDEST entries first', () => {
    const buf = createConsoleCaptureBuffer({ maxBuffered: 3 });
    for (let ts = 1; ts <= 5; ts++) {
      buf.push(
        buildConsolePluginEvent(ts, {
          level: 'log',
          trace: [],
          payload: [`m-${ts}`],
        }),
      );
    }
    const drained = buf.drain();
    expect(drained).toHaveLength(3);
    expect(drained.map((e) => e.ts)).toEqual([3, 4, 5]);
  });

  test('exactly at maxBuffered, no eviction', () => {
    const buf = createConsoleCaptureBuffer({ maxBuffered: 3 });
    for (let ts = 1; ts <= 3; ts++) {
      buf.push(
        buildConsolePluginEvent(ts, {
          level: 'log',
          trace: [],
          payload: [`m-${ts}`],
        }),
      );
    }
    expect(buf.size()).toBe(3);
    expect(buf.drain().map((e) => e.ts)).toEqual([1, 2, 3]);
  });

  test('maxBuffered of 1 keeps only the most recent event', () => {
    const buf = createConsoleCaptureBuffer({ maxBuffered: 1 });
    for (let ts = 1; ts <= 5; ts++) {
      buf.push(
        buildConsolePluginEvent(ts, {
          level: 'log',
          trace: [],
          payload: [`m-${ts}`],
        }),
      );
    }
    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]?.ts).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Custom level filter (documents pass-through behavior)
// ────────────────────────────────────────────────────────────────────────────

describe('level option', () => {
  // The buffer does NOT re-filter by level — that's the plugin's job at
  // capture time. If a synthetic plugin event reaches push() with a level
  // outside the configured set, we still buffer it (the assumption is the
  // plugin only emits configured levels). This test pins that behavior so
  // we'd notice if a future refactor accidentally added a second filter.
  test('synthetic event of any level is buffered regardless of options.level', () => {
    const buf = createConsoleCaptureBuffer({ level: ['warn', 'error'] });
    buf.push(
      buildConsolePluginEvent(1, {
        level: 'log', // Not in the configured set.
        trace: [],
        payload: ['hello'],
      }),
    );
    buf.push(
      buildConsolePluginEvent(2, {
        level: 'error',
        trace: ['x'],
        payload: ['boom'],
      }),
    );
    const drained = buf.drain();
    expect(drained.map((e) => e.level)).toEqual(['log', 'error']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. Recursion guard — buffer code never calls console.*
// ────────────────────────────────────────────────────────────────────────────

describe('recursion guard — push() never touches console.*', () => {
  /**
   * Stub every console method to throw. If the buffer code calls ANY
   * `console.*` from inside push/drain/peek, the spy throws and the
   * test fails — even if push silently swallows errors.
   */
  function stubConsoleToTrap(): { restore: () => void; spies: Array<ReturnType<typeof vi.fn>> } {
    const methods = [
      'log',
      'info',
      'warn',
      'error',
      'debug',
      'trace',
      'assert',
      'dir',
      'group',
      'groupCollapsed',
      'groupEnd',
      'table',
      'time',
      'timeEnd',
      'timeLog',
      'count',
      'countReset',
      'clear',
      'dirxml',
    ] as const;
    const original: Record<string, unknown> = {};
    const spies: Array<ReturnType<typeof vi.fn>> = [];
    for (const m of methods) {
      original[m] = (globalThis.console as unknown as Record<string, unknown>)[m];
      const spy = vi.fn(() => {
        throw new Error(`console.${m} was called from buffer code`);
      });
      (globalThis.console as unknown as Record<string, unknown>)[m] = spy;
      spies.push(spy);
    }
    return {
      restore: () => {
        for (const m of methods) {
          (globalThis.console as unknown as Record<string, unknown>)[m] = original[m];
        }
      },
      spies,
    };
  }

  test('push() of a malformed payload (null data) does not call console.*', () => {
    const buf = createConsoleCaptureBuffer();
    const { restore, spies } = stubConsoleToTrap();
    try {
      const malformed: eventWithTime = {
        type: EventType.Plugin,
        timestamp: 1,
        data: null,
      } as unknown as eventWithTime;
      expect(() => buf.push(malformed)).not.toThrow();
    } finally {
      restore();
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(buf.size()).toBe(0);
  });

  test('push() of a malformed payload (wrong field types) does not call console.*', () => {
    const buf = createConsoleCaptureBuffer();
    const { restore, spies } = stubConsoleToTrap();
    try {
      const malformed: eventWithTime = {
        type: EventType.Plugin,
        timestamp: 1,
        data: {
          plugin: 'rrweb/console@1',
          payload: {
            level: 'log',
            trace: 'not-an-array', // wrong type
            payload: ['hi'],
          },
        },
      } as unknown as eventWithTime;
      expect(() => buf.push(malformed)).not.toThrow();
    } finally {
      restore();
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(buf.size()).toBe(0);
  });

  test('push() of a well-formed payload does not call console.*', () => {
    const buf = createConsoleCaptureBuffer();
    const { restore, spies } = stubConsoleToTrap();
    try {
      buf.push(
        buildConsolePluginEvent(1, {
          level: 'log',
          trace: [],
          payload: ['safe'],
        }),
      );
    } finally {
      restore();
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(buf.size()).toBe(1);
  });

  test('drain() and peek() do not call console.*', () => {
    const buf = createConsoleCaptureBuffer();
    buf.push(
      buildConsolePluginEvent(1, {
        level: 'log',
        trace: [],
        payload: ['a'],
      }),
    );
    const { restore, spies } = stubConsoleToTrap();
    try {
      const snap = buf.peek();
      const drained = buf.drain();
      expect(snap).toHaveLength(1);
      expect(drained).toHaveLength(1);
    } finally {
      restore();
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 8. Type-level sanity — ConsoleEvent exported from package barrel
// ────────────────────────────────────────────────────────────────────────────

describe('public API surface', () => {
  test('ConsoleEvent shape is consumable as documented', () => {
    const event: ConsoleEvent = {
      ts: 1,
      level: 'log',
      args: ['hello'],
    };
    expect(event.ts).toBe(1);
    expect(event.level).toBe('log');
    expect(event.args).toEqual(['hello']);
    expect(event.trace).toBeUndefined();
  });

  test('ConsoleEvent can carry a trace', () => {
    const event: ConsoleEvent = {
      ts: 2,
      level: 'error',
      args: ['boom'],
      trace: ['at foo:1'],
    };
    expect(event.trace).toEqual(['at foo:1']);
  });
});
