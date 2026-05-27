import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_CHARS, DEFAULT_MAX_COUNT, EventBatcher, roughSize } from '../relay/batch';

describe('EventBatcher', () => {
  it('buffers below the count threshold without signalling a flush', () => {
    const b = new EventBatcher<number>({ maxCount: 3 });
    expect(b.add(1)).toBe(false);
    expect(b.add(2)).toBe(false);
    expect(b.size).toBe(2);
    expect(b.isEmpty).toBe(false);
  });

  it('signals a flush when the count threshold is reached', () => {
    const b = new EventBatcher<number>({ maxCount: 3 });
    b.add(1);
    b.add(2);
    expect(b.add(3)).toBe(true); // 3rd hits maxCount
  });

  it('signals a flush when the char-size budget is exceeded', () => {
    const b = new EventBatcher<string>({ maxCount: 1000, maxChars: 20 });
    // Each string is ~12 chars once JSON-stringified ("xxxxxxxxxx" + quotes).
    expect(b.add('xxxxxxxxxx')).toBe(false);
    expect(b.add('xxxxxxxxxx')).toBe(true); // cumulative > 20
  });

  it('drain() returns buffered items and resets size + char budget', () => {
    const b = new EventBatcher<number>({ maxCount: 10 });
    b.add(1);
    b.add(2);
    expect(b.drain()).toEqual([1, 2]);
    expect(b.size).toBe(0);
    expect(b.isEmpty).toBe(true);
    // After draining, the char budget is reset — buffering restarts cleanly.
    expect(b.add(3)).toBe(false);
    expect(b.drain()).toEqual([3]);
  });

  it('uses sane defaults', () => {
    expect(DEFAULT_MAX_COUNT).toBe(50);
    expect(DEFAULT_MAX_CHARS).toBe(256 * 1024);
    const b = new EventBatcher<number>();
    for (let i = 0; i < DEFAULT_MAX_COUNT - 1; i++) expect(b.add(i)).toBe(false);
    expect(b.add(999)).toBe(true);
  });
});

describe('roughSize', () => {
  it('measures JSON length', () => {
    expect(roughSize('abc')).toBe(5); // "abc" with quotes
    expect(roughSize({ a: 1 })).toBe(7); // {"a":1}
  });

  it('falls back to a constant for non-serializable values (cycles)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(roughSize(cyclic)).toBe(64);
  });
});
