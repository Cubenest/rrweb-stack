import { describe, expect, it } from 'vitest';
import { cutoffBefore, parseDuration } from '../src/lib/duration.js';

describe('parseDuration', () => {
  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseDuration('15m')).toBe(15 * 60_000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(60 * 60_000);
  });

  it('parses days', () => {
    expect(parseDuration('7d')).toBe(7 * 24 * 60 * 60_000);
  });

  it('parses weeks', () => {
    expect(parseDuration('2w')).toBe(2 * 7 * 24 * 60 * 60_000);
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseDuration('  1H ')).toBe(60 * 60_000);
  });

  it('tolerates whitespace between number and unit', () => {
    expect(parseDuration('1 h')).toBe(60 * 60_000);
  });

  it('accepts zero', () => {
    expect(parseDuration('0d')).toBe(0);
  });

  it.each(['', '1', 'h', '1x', '-1h', '1.5h', '1hh', 'abc', '1h2m'])(
    'rejects invalid input %j',
    (bad) => {
      expect(() => parseDuration(bad)).toThrow(/invalid duration/);
    },
  );
});

describe('cutoffBefore', () => {
  it('subtracts the duration from the provided now', () => {
    const now = 1_000_000_000_000;
    expect(cutoffBefore('1h', now)).toBe(now - 60 * 60_000);
  });

  it('returns now for a zero duration', () => {
    const now = 1_000_000_000_000;
    expect(cutoffBefore('0s', now)).toBe(now);
  });
});
