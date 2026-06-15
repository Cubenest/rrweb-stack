// Optional security-suppression file loader (ported from @tracelane/wdio).
//
// tracelane's advisory security analyzer (`@tracelane/security`) accepts a list
// of `Suppression` rules to silence known-acceptable signals. To let teams
// commit those rules alongside their suite, the playwright adapter looks for a
// `tracelane.security.suppress.json` in the project cwd at report-write time.
//
// This loader is deliberately defensive: a missing, unreadable, malformed, or
// wrong-shaped file MUST NEVER throw and MUST NEVER break the report. Any of
// those cases degrade to `[]` (no suppressions). The file only ever carries
// advisory `{ signal?, evidence? }` rules — no secrets — so reading it from cwd
// is safe (P1 security MVP privacy invariant).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Suppression } from '@tracelane/report';

/** The fixed filename looked up in the project cwd. */
export const SUPPRESS_FILE_NAME = 'tracelane.security.suppress.json';

/**
 * Coerce arbitrary parsed JSON into a `Suppression[]`, leniently:
 *   - a bare array → used as-is;
 *   - an object with a `suppressions` array → that array;
 *   - anything else → `[]`.
 *
 * Element shape is not validated beyond "is an object" — the analyzer reads
 * only `signal` / `evidence` and ignores the rest, so a loose pass-through is
 * both safe and forgiving of hand-edited files.
 */
function coerceSuppressions(parsed: unknown): Suppression[] {
  const arr = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.suppressions)
      ? parsed.suppressions
      : undefined;
  if (!arr) return [];
  return arr.filter(isRecord) as Suppression[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Load `tracelane.security.suppress.json` from `cwd`, if present. Returns the
 * parsed suppression rules, or `[]` when the file is missing/unreadable/
 * malformed/wrong-shaped. Never throws.
 */
export function loadSecuritySuppressions(cwd: string): Suppression[] {
  const filePath = join(cwd, SUPPRESS_FILE_NAME);
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf8');
    return coerceSuppressions(JSON.parse(raw));
  } catch {
    // Missing/unreadable/malformed file must never break the report.
    return [];
  }
}
