// Pure duration parsing for `--since 1h` / `--all-older-than 7d` (P2 PRD §C.1,
// §H3). Accepts a short human duration and returns milliseconds. Kept pure +
// dependency-free so it can be unit-tested exhaustively; the commands that use
// it derive an absolute cutoff via `Date.now() - parseDuration(...)`.

/** Suffix → milliseconds multiplier. */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const DURATION_RE = /^(\d+)\s*([smhdw])$/;

/**
 * Parse a short duration string (`30s`, `15m`, `1h`, `7d`, `2w`) into
 * milliseconds. The numeric part must be a non-negative integer; the unit is
 * one of s/m/h/d/w (case-insensitive). Throws a user-facing `Error` on anything
 * else so the caller can print it and exit non-zero.
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = DURATION_RE.exec(trimmed);
  if (!match) {
    throw new Error(
      `invalid duration "${input}" — expected a number followed by s, m, h, d, or w (e.g. 30m, 1h, 7d)`,
    );
  }
  // match[1]/match[2] are guaranteed present by the regex shape above, and the
  // unit is restricted to [smhdw] — every one a key of UNIT_MS.
  const value = Number(match[1] as string);
  const unit = match[2] as keyof typeof UNIT_MS;
  const multiplier = UNIT_MS[unit] ?? 0;
  return value * multiplier;
}

/**
 * Resolve a duration into an absolute "older than" cutoff timestamp (epoch ms):
 * everything strictly before the returned instant is "older than" the duration.
 * `now` is injectable for deterministic tests.
 */
export function cutoffBefore(input: string, now: number = Date.now()): number {
  return now - parseDuration(input);
}
