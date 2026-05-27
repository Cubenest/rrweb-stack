import { describe, expect, it } from 'vitest';
import {
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  backoffSequence,
  jitter,
  nextBackoffMs,
} from '../background/backoff';

describe('nextBackoffMs', () => {
  it('doubles the delay each step', () => {
    expect(nextBackoffMs(1_000)).toBe(2_000);
    expect(nextBackoffMs(2_000)).toBe(4_000);
    expect(nextBackoffMs(4_000)).toBe(8_000);
    expect(nextBackoffMs(8_000)).toBe(16_000);
    expect(nextBackoffMs(16_000)).toBe(32_000);
  });

  it('caps at MAX_BACKOFF_MS (60s)', () => {
    expect(nextBackoffMs(32_000)).toBe(60_000);
    expect(nextBackoffMs(60_000)).toBe(60_000);
    expect(nextBackoffMs(120_000)).toBe(60_000);
  });

  it('resets sub-floor / non-finite values to the floor', () => {
    expect(nextBackoffMs(0)).toBe(INITIAL_BACKOFF_MS);
    expect(nextBackoffMs(-5)).toBe(INITIAL_BACKOFF_MS);
    expect(nextBackoffMs(Number.NaN)).toBe(INITIAL_BACKOFF_MS);
    expect(nextBackoffMs(Number.POSITIVE_INFINITY)).toBe(INITIAL_BACKOFF_MS);
    expect(nextBackoffMs(500)).toBe(INITIAL_BACKOFF_MS);
  });
});

describe('backoffSequence', () => {
  it('produces the exact 1s → 60s schedule from ADR-0009', () => {
    expect(backoffSequence()).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000]);
  });

  it('starts at the floor and ends at the cap', () => {
    const seq = backoffSequence();
    expect(seq[0]).toBe(INITIAL_BACKOFF_MS);
    expect(seq[seq.length - 1]).toBe(MAX_BACKOFF_MS);
  });
});

describe('jitter', () => {
  it('returns a value in [0, delay) using the provided rng', () => {
    expect(jitter(10_000, () => 0)).toBe(0);
    expect(jitter(10_000, () => 0.5)).toBe(5_000);
    expect(jitter(10_000, () => 0.999_99)).toBe(9_999);
  });

  it('never exceeds the delay', () => {
    for (let i = 0; i <= 10; i++) {
      const r = i / 10;
      const j = jitter(60_000, () => Math.min(r, 0.999_999));
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(60_000);
    }
  });

  it('returns 0 for non-positive / non-finite delays', () => {
    expect(jitter(0)).toBe(0);
    expect(jitter(-1)).toBe(0);
    expect(jitter(Number.NaN)).toBe(0);
  });
});
