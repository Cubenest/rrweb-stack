// Console capture buffer — Task 1.8.
//
// Wraps the upstream `@rrweb/rrweb-plugin-console-record` (re-exported via
// `../rrweb` per Task 1.2) with two concerns the plugin doesn't own:
//
//   1. A bounded in-memory buffer that consumers can `drain()` on demand
//      (P1: dump-on-fail; P2: dump-on-MCP-tool-call). The plugin only
//      emits events into rrweb's event stream — it doesn't buffer them
//      itself.
//
//   2. A normalized event shape (`ConsoleEvent`) that hides the awkward
//      double-`payload` naming in the raw rrweb plugin event
//      (`event.data.payload.payload` is the args array).
//
// The plugin's emitted shape, verified against
// `@rrweb/rrweb-plugin-console-record@2.0.0-alpha.20`'s `dist/index.d.ts`
// and source (`initLogObserver` → `cb({ level, trace, payload })` →
// rrweb's `wrappedEmit({ type: 6, data: { plugin: 'rrweb/console@1',
// payload: <LogData> } })`), is:
//
//   {
//     type: 6 /* EventType.Plugin */,
//     timestamp: number,
//     data: {
//       plugin: 'rrweb/console@1',
//       payload: {
//         level: LogLevel,
//         trace: string[],
//         payload: string[]  /* the stringified args */
//       }
//     }
//   }
//
// ── Recursion guard ────────────────────────────────────────────────────────
// The plugin patches `console.*` to call `cb(…)` AFTER invoking the
// original. If our buffer code itself called `console.*`, that would
// re-enter the patch and emit a synthetic event for every event we
// process — fast path to infinite recursion (the plugin has its own
// `inStack` guard but we should not rely on it, since we sit OUTSIDE
// the plugin in the rrweb event pipeline).
//
// Therefore: no `console.*` calls from this module. If `push()` sees a
// malformed plugin event (wrong shape, missing fields), it silently
// ignores it — better to lose one buggy event than risk a recursive
// flood from a defensive log line. Tests cover this contract.

import { EventType, getRecordConsolePlugin } from '../rrweb.js';
import type { eventWithTime } from '../rrweb.js';
import type { ConsoleEvent, ConsoleLevel } from './types.js';

/** Vendor's plugin name string — emitted as `event.data.plugin`. */
const CONSOLE_PLUGIN_NAME = 'rrweb/console@1';

/** Default cap on retained events before FIFO eviction kicks in. */
const DEFAULT_MAX_BUFFERED = 5000;

/** Default per-argument string truncation cap (matches plugin default). */
const DEFAULT_STRING_LENGTH_LIMIT = 1000;

/** Default object-key count cap when serializing arguments. */
const DEFAULT_NUM_OF_KEYS_LIMIT = 100;

/**
 * Default object-graph depth limit. Kept SHALLOW (1) because console.log
 * is often called with whole DOM nodes or huge state objects, and a
 * deeper serializer would inflate event size into the multi-MB range.
 * Consumers that actually want deep object dumps can override.
 */
const DEFAULT_DEPTH_OF_LIMIT = 1;

/**
 * Default plugin-level event cap (the plugin has its own `lengthThreshold`
 * that emits a warning + stops calling cb once exceeded — defaults to 1000
 * in the plugin, but we raise it slightly so the plugin's own cap doesn't
 * bite before our buffer cap does. Set to 10_000 to match what the plan
 * documents as the per-event size budget across the substrate.
 */
const DEFAULT_LENGTH_THRESHOLD = 10_000;

/**
 * Factory-time configuration for `createConsoleCaptureBuffer`.
 */
export interface ConsoleCaptureOptions {
  /**
   * Console levels to capture. When omitted, the plugin's default level
   * list is used (the full 19-level vocabulary documented on `ConsoleLevel`).
   * Most consumers will narrow this to the `BasicConsoleLevel` quartet.
   */
  level?: ConsoleLevel[];
  /**
   * Max number of plugin-side log records before the plugin emits a
   * single threshold warning and stops invoking the callback. Forwarded
   * to the plugin verbatim — this is NOT the same as `maxBuffered` (which
   * is OUR ring-buffer cap, applied after the plugin emits).
   * Default: 10_000.
   */
  lengthThreshold?: number;
  /**
   * Serializer knobs forwarded to the plugin's `stringify` step. Defaults
   * favor short, shallow output — long string clip at 1000 chars, object
   * keys clip at 100, depth clips at 1.
   */
  stringifyOptions?: {
    stringLengthLimit?: number;
    numOfKeysLimit?: number;
    depthOfLimit?: number;
  };
  /**
   * Max number of `ConsoleEvent`s retained in the buffer. When `push()`
   * would push beyond this cap, the OLDEST entries are dropped (FIFO).
   * Default: 5000.
   */
  maxBuffered?: number;
}

/**
 * The public buffer surface. Consumers register `plugin` with the rrweb
 * recorder AND forward every emitted rrweb event into `push()`:
 *
 *   const buf = createConsoleCaptureBuffer();
 *   record({
 *     emit: (event) => { buf.push(event); ...your other sinks... },
 *     plugins: [buf.plugin],
 *   });
 *
 * The split (plugin registration ↔ event forwarding) is intentional:
 * rrweb owns the recording lifecycle, we own the normalized buffer.
 */
export interface ConsoleCaptureBuffer {
  /**
   * The rrweb plugin instance to pass into `record({ plugins: [...] })`.
   * Same shape as a direct `getRecordConsolePlugin(...)` call — the buffer
   * wrapper does not re-shape it.
   */
  readonly plugin: ReturnType<typeof getRecordConsolePlugin>;
  /**
   * Feed an rrweb event into the buffer. Events of type
   * `EventType.Plugin` (6) with `data.plugin === 'rrweb/console@1'` are
   * normalized into `ConsoleEvent` and pushed onto the ring buffer; all
   * other events are silently ignored (this method is safe to wire
   * unconditionally inside the rrweb `emit` callback).
   *
   * Malformed plugin events (missing fields, wrong types) are silently
   * dropped — see "Recursion guard" in the module header for why we
   * never throw or log from this path.
   */
  push(event: eventWithTime): void;
  /**
   * Returns and EMPTIES the buffer. Used by P1 on test-fail to ship the
   * captured console alongside the rrweb event stream, and by P2 on MCP
   * tool invocation to surface recent logs to the model.
   */
  drain(): ConsoleEvent[];
  /**
   * Returns a read-only snapshot of the buffer WITHOUT emptying it. Used
   * by surfaces that want to render the current state without disturbing
   * the buffer (e.g. live debug overlays).
   */
  peek(): readonly ConsoleEvent[];
  /**
   * Current number of `ConsoleEvent`s retained in the buffer.
   */
  size(): number;
}

/**
 * Type guard for the structural shape of a console-plugin event's payload.
 * Returns true ONLY when `value` matches the LogData contract:
 * `{ level: string, trace: string[], payload: string[] }`. Anything else
 * is treated as malformed and dropped by `push()`.
 */
function isConsoleLogData(value: unknown): value is {
  level: ConsoleLevel;
  trace: string[];
  payload: string[];
} {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { level?: unknown; trace?: unknown; payload?: unknown };
  if (typeof candidate.level !== 'string') return false;
  if (!Array.isArray(candidate.trace)) return false;
  if (!Array.isArray(candidate.payload)) return false;
  // All trace + payload entries must be strings (plugin enforces this; we
  // double-check to keep the consumer-facing shape strict).
  for (const t of candidate.trace) if (typeof t !== 'string') return false;
  for (const p of candidate.payload) if (typeof p !== 'string') return false;
  return true;
}

/**
 * Create a console capture buffer.
 *
 * The returned `plugin` field is the rrweb plugin instance — consumers
 * pass it into `record({ plugins: [...] })`. The returned `push`/`drain`/
 * `peek`/`size` methods operate on the bounded ring buffer.
 *
 * @see ConsoleCaptureOptions for tuning knobs.
 * @see ConsoleCaptureBuffer for the runtime API.
 */
export function createConsoleCaptureBuffer(
  options: ConsoleCaptureOptions = {},
): ConsoleCaptureBuffer {
  const maxBuffered = options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
  const stringifyOptions = {
    stringLengthLimit: options.stringifyOptions?.stringLengthLimit ?? DEFAULT_STRING_LENGTH_LIMIT,
    numOfKeysLimit: options.stringifyOptions?.numOfKeysLimit ?? DEFAULT_NUM_OF_KEYS_LIMIT,
    depthOfLimit: options.stringifyOptions?.depthOfLimit ?? DEFAULT_DEPTH_OF_LIMIT,
  };

  // Build the plugin. Only forward `level` when the caller specified it —
  // otherwise the plugin's own default-level list applies (the full 19-
  // level vocabulary), which is what consumers usually want.
  const plugin = getRecordConsolePlugin({
    ...(options.level !== undefined ? { level: options.level } : {}),
    lengthThreshold: options.lengthThreshold ?? DEFAULT_LENGTH_THRESHOLD,
    stringifyOptions,
  });

  // Ring buffer. We use a plain array + shift() for eviction; for the
  // sizes we expect (single-digit thousands), the O(n) shift is fine and
  // the code is dramatically simpler than a circular index.
  const buffer: ConsoleEvent[] = [];

  function push(event: eventWithTime): void {
    // Filter: only plugin events from the console-record plugin reach the
    // buffer. Everything else (DOM mutations, mouse moves, snapshots) is
    // ignored — consumers can forward the full event stream into push()
    // without filtering upstream.
    if (event.type !== EventType.Plugin) return;
    const data = event.data;
    if (data === null || typeof data !== 'object') return;
    const { plugin: pluginName, payload } = data as {
      plugin?: unknown;
      payload?: unknown;
    };
    if (pluginName !== CONSOLE_PLUGIN_NAME) return;
    if (!isConsoleLogData(payload)) return;

    // Normalize: drop trace if empty (no signal in an empty array), and
    // freeze the args array so consumers can't mutate buffered state.
    const normalized: ConsoleEvent = {
      ts: event.timestamp,
      level: payload.level,
      args: [...payload.payload],
      ...(payload.trace.length > 0 ? { trace: [...payload.trace] } : {}),
    };

    buffer.push(normalized);

    // FIFO eviction. The buffer can be over capacity by exactly one entry
    // after push, so a single shift suffices — but keep the loop in case
    // a future caller mutates maxBuffered downward at runtime.
    while (buffer.length > maxBuffered) {
      buffer.shift();
    }
  }

  function drain(): ConsoleEvent[] {
    const out = buffer.slice();
    buffer.length = 0;
    return out;
  }

  function peek(): readonly ConsoleEvent[] {
    return buffer.slice();
  }

  function size(): number {
    return buffer.length;
  }

  return { plugin, push, drain, peek, size };
}
