/**
 * Event batching for the ISOLATED relay (Task 3.20 — "chunk-batching before
 * native-messaging send").
 *
 * rrweb emits a flurry of small events; one `chrome.runtime.sendMessage` per
 * event would flood the SW and, downstream, the native port. The relay
 * accumulates events and flushes a batch when EITHER a count or a (rough,
 * char-based) byte budget is reached, or when a max-age timer fires so a quiet
 * tail still ships promptly. This `EventBatcher` owns the buffer + thresholds
 * (pure, unit-tested); the relay owns the actual timer + `sendMessage` (E2E).
 */

/** Tunables for {@link EventBatcher}. Defaults are conservative for MV3. */
export interface BatchOptions {
  /** Flush when the buffer reaches this many items. Default 50. */
  maxCount?: number;
  /**
   * Flush when the buffer's rough serialized size reaches this many chars.
   * A char-count proxy for bytes — cheap and good enough to bound message
   * size below Chrome's runtime-message limits. Default 256 KiB.
   */
  maxChars?: number;
}

export const DEFAULT_MAX_COUNT = 50;
export const DEFAULT_MAX_CHARS = 256 * 1024;

/**
 * Accumulates items and reports when a flush threshold trips. Storage-agnostic:
 * the caller decides what to do with a flushed batch (`drain()`), and arms its
 * own max-age timer. `add()` returns `true` when the caller should flush NOW
 * (count or size budget hit) so a hot loop flushes synchronously without
 * waiting for the timer.
 */
export class EventBatcher<T> {
  private readonly maxCount: number;
  private readonly maxChars: number;
  private buffer: T[] = [];
  private chars = 0;

  constructor(options: BatchOptions = {}) {
    this.maxCount = options.maxCount ?? DEFAULT_MAX_COUNT;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  }

  /** Number of buffered items not yet drained. */
  get size(): number {
    return this.buffer.length;
  }

  /** Whether there is anything to flush. */
  get isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Add an item. Returns `true` if a threshold (count or size) is now met and
   * the caller should `drain()` + send immediately; `false` if the item was
   * buffered and can wait for the max-age timer.
   */
  add(item: T): boolean {
    this.buffer.push(item);
    this.chars += roughSize(item);
    return this.buffer.length >= this.maxCount || this.chars >= this.maxChars;
  }

  /** Remove and return all buffered items, resetting the buffer. */
  drain(): T[] {
    const out = this.buffer;
    this.buffer = [];
    this.chars = 0;
    return out;
  }
}

/**
 * Rough serialized size of a value in characters. Uses `JSON.stringify` length;
 * on a value that can't be stringified (cycles), falls back to a small constant
 * so one bad item can't make the batch grow unbounded.
 */
export function roughSize(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s.length : 64;
  } catch {
    return 64;
  }
}
