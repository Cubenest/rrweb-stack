import { describe, expect, it } from 'vitest';
import {
  CONNECTION_HELD_MS,
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  RECONNECT_STALLED_AFTER_ATTEMPTS,
  backoffSequence,
  isReconnectStalled,
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
    const first = seq.at(0);
    const last = seq.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first).toBe(INITIAL_BACKOFF_MS);
    expect(last).toBe(MAX_BACKOFF_MS);
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

describe('isReconnectStalled — surface the setup hint after persistent failure', () => {
  it('is false below the threshold (transient host restart / brief blip)', () => {
    expect(isReconnectStalled(0)).toBe(false);
    expect(isReconnectStalled(1)).toBe(false);
    expect(isReconnectStalled(RECONNECT_STALLED_AFTER_ATTEMPTS - 1)).toBe(false);
  });

  it('is true at and beyond the threshold (host almost certainly unregistered)', () => {
    expect(isReconnectStalled(RECONNECT_STALLED_AFTER_ATTEMPTS)).toBe(true);
    expect(isReconnectStalled(RECONNECT_STALLED_AFTER_ATTEMPTS + 5)).toBe(true);
  });

  it('treats negative / non-finite attempt counts as not-stalled (defensive)', () => {
    expect(isReconnectStalled(-1)).toBe(false);
    expect(isReconnectStalled(Number.NaN)).toBe(false);
    expect(isReconnectStalled(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('the threshold is reached within a reasonable wait (≈ a few seconds of backoff)', () => {
    // With the 1s→2s→4s schedule, the first few attempts elapse in seconds, so
    // a stalled state is surfaced promptly rather than leaving the user staring
    // at a perpetual "Reconnecting…" pill.
    expect(RECONNECT_STALLED_AFTER_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(RECONNECT_STALLED_AFTER_ATTEMPTS).toBeLessThanOrEqual(6);
  });
});

describe('CONNECTION_HELD_MS — the disconnect-storm guard window', () => {
  it('is shorter than the initial backoff so a healthy host clears the counter before the next retry', () => {
    // background.ts only resets reconnectAttempts after the port HOLDS for
    // CONNECTION_HELD_MS. If that window were ≥ the retry delay, a genuinely
    // connected host could be scheduled for another reconnect before the reset
    // landed. Keeping it strictly below INITIAL_BACKOFF_MS guarantees a real
    // connection clears the stalled signal first.
    expect(CONNECTION_HELD_MS).toBeGreaterThan(0);
    expect(CONNECTION_HELD_MS).toBeLessThan(INITIAL_BACKOFF_MS);
  });
});
