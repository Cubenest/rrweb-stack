/**
 * Exponential reconnect-backoff for the native-messaging port (ADR-0009).
 *
 * Pure, side-effect-free arithmetic so it can be unit-tested without any
 * `chrome.*` mocks. The background service worker (background.ts) owns the
 * timing and the actual `setTimeout`; this module only answers "given the
 * current delay, what is the next delay?".
 *
 * Schedule: 1s → 2s → 4s → 8s → 16s → 32s → 60s (cap) → 60s …
 */

/** Initial reconnect delay, in milliseconds. */
export const INITIAL_BACKOFF_MS = 1_000;

/** Upper bound on the reconnect delay, in milliseconds (ADR-0009: 60s cap). */
export const MAX_BACKOFF_MS = 60_000;

/**
 * Double the current delay, capped at {@link MAX_BACKOFF_MS}.
 *
 * @param currentMs the delay just used for a reconnect attempt
 * @returns the delay to use for the *next* attempt
 */
export function nextBackoffMs(currentMs: number): number {
  if (!Number.isFinite(currentMs) || currentMs < INITIAL_BACKOFF_MS) {
    // Defensive: a corrupted/never-initialised value resets to the floor
    // rather than producing NaN or hammering the host with a 0ms loop.
    return INITIAL_BACKOFF_MS;
  }
  return Math.min(currentMs * 2, MAX_BACKOFF_MS);
}

/**
 * Apply optional full jitter to a delay (ADR-0009 action item #3 asks for
 * jitter). "Full jitter" picks a uniformly random value in `[0, delayMs]`,
 * which de-synchronises many extensions reconnecting to a host that just
 * restarted. Pass a deterministic `rng` in tests.
 *
 * @param delayMs the (already-capped) backoff delay
 * @param rng a `() => number` in `[0, 1)`; defaults to `Math.random`
 */
export function jitter(delayMs: number, rng: () => number = Math.random): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return 0;
  return Math.floor(rng() * delayMs);
}

/**
 * Produce the full sequence of delays from the floor up to (and including) the
 * cap. Handy for documentation/tests; not used on the hot path.
 */
export function backoffSequence(): number[] {
  const seq: number[] = [INITIAL_BACKOFF_MS];
  let cur = INITIAL_BACKOFF_MS;
  while (cur < MAX_BACKOFF_MS) {
    cur = nextBackoffMs(cur);
    seq.push(cur);
  }
  return seq;
}
