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
 * How long a freshly-opened native port must stay connected before we trust it
 * and clear the failed-reconnect counter. An unregistered host on Chrome
 * returns a port that immediately fires `onDisconnect` ("host not found") — a
 * disconnect-storm, not a synchronous throw. Resetting the counter the instant
 * a port handle appears would zero it every storm cycle and the stall hint
 * would never surface; so the reset is gated behind this short "did the
 * connection hold?" window. Kept below {@link INITIAL_BACKOFF_MS} so a healthy
 * host clears the counter well before the next scheduled reconnect.
 */
export const CONNECTION_HELD_MS = 750;

/**
 * Consecutive failed reconnect attempts after which we treat the native host as
 * "stalled" — i.e. almost certainly never registered — rather than briefly
 * blipping. At 4 attempts the 1s→2s→4s schedule has elapsed ~7s, long past a
 * normal host restart, so the side panel can confidently surface the
 * "run `peek init`" setup hint instead of a perpetual "Reconnecting…" pill
 * (the Windows audit bug: connectNative throws when the host isn't registered,
 * the state machine parks in 'reconnecting', and the disconnected-only hint is
 * unreachable).
 */
export const RECONNECT_STALLED_AFTER_ATTEMPTS = 4;

/**
 * Has the native-host reconnect loop been failing long enough that the host is
 * almost certainly unregistered (vs. a transient restart)? Pure + side-effect
 * free so the side panel and SW share one definition of "stalled".
 *
 * @param attempts consecutive failed reconnect attempts since the last connect
 */
export function isReconnectStalled(attempts: number): boolean {
  if (!Number.isFinite(attempts)) {
    // A non-finite count is only "stalled" if it's +Infinity (unboundedly many
    // failures); NaN / -Infinity are treated as not-stalled (defensive).
    return attempts === Number.POSITIVE_INFINITY;
  }
  return attempts >= RECONNECT_STALLED_AFTER_ATTEMPTS;
}

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
