import { describe, expect, it } from 'vitest';
import { parseSize } from '../src/lib/size.js';

describe('parseSize', () => {
  it('parses B/KB/MB/GB with binary multiples', () => {
    expect(parseSize('512B')).toBe(512);
    expect(parseSize('1KB')).toBe(1024);
    expect(parseSize('2MB')).toBe(2 * 1024 * 1024);
    expect(parseSize('3GB')).toBe(3 * 1024 * 1024 * 1024);
  });
  it('is case- and space-insensitive', () => {
    expect(parseSize('  2 gb ')).toBe(2 * 1024 * 1024 * 1024);
  });
  it('throws a helpful error on bad input', () => {
    expect(() => parseSize('lots')).toThrow(/invalid size/i);
    expect(() => parseSize('10')).toThrow(/invalid size/i);
    expect(() => parseSize('10TB')).toThrow(/invalid size/i);
  });
});
