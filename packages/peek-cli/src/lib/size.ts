// Pure size parsing for `--max-size 500MB` style flags (P2 PRD §H3.4). Accepts
// a human size string and returns bytes (binary multiples). Kept pure +
// dependency-free so it can be unit-tested exhaustively.

/** Suffix → bytes multiplier (binary multiples). */
const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

const SIZE_RE = /^(\d+)\s*(b|kb|mb|gb)$/;

/**
 * Parse a human size string (`512B`, `1KB`, `2MB`, `3GB`) into bytes (binary
 * multiples). The numeric part must be a non-negative integer; the unit is one
 * of B/KB/MB/GB (case-insensitive). Throws a user-facing `Error` on anything
 * else so the caller can print it and exit non-zero.
 */
export function parseSize(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = SIZE_RE.exec(trimmed);
  if (!match) {
    throw new Error(
      `invalid size "${input}" — expected a number followed by B, KB, MB, or GB (e.g. 500MB, 2GB)`,
    );
  }
  // match[1]/match[2] are guaranteed present by the regex shape above, and the
  // unit is restricted to [b|kb|mb|gb] — every one a key of UNIT_BYTES.
  const value = Number(match[1] as string);
  const unit = match[2] as keyof typeof UNIT_BYTES;
  const multiplier = UNIT_BYTES[unit] ?? 0;
  return value * multiplier;
}
