/**
 * Destructive-action heuristics (Task 3.23, ADR-0010, P2 PRD §E.3).
 *
 * Substring matcher (case-insensitive) over a candidate's button text /
 * aria-label / nearby heading. A match means "even at Level 4 YOLO, REQUIRE
 * confirmation" — mirrors Anthropic Claude for Chrome's *"Claude still asks
 * permission for high-risk actions like purchases or data deletion"* override.
 *
 * Two seams of extensibility:
 *   - Built-in BASE_DESTRUCTIVE_TERMS shipped with the extension (the ADR-0010
 *     list).
 *   - User-supplied add/remove from `~/.peek/policy.json`. The native host reads
 *     the policy file and forwards the deltas on each action request; the
 *     MAIN-world dispatcher merges them at decision time. Keeps the matcher
 *     pure + free of `chrome.*` so it unit-tests cleanly.
 *
 * "Substring" means a destructive term need only APPEAR inside the candidate
 * label (case-insensitive). "delete account" → matches `delete`. Word-boundary
 * checks were rejected to avoid false-NEGATIVES from compound buttons like
 * "Yes, delete!" or "✕ Delete row".
 */

/**
 * The hardcoded base list from ADR-0010 / P2 PRD §E.3. Lowercase, sorted for
 * stable diffs, no leading/trailing whitespace.
 */
export const BASE_DESTRUCTIVE_TERMS: readonly string[] = Object.freeze([
  'buy',
  'cancel subscription',
  'confirm',
  'delete',
  'logout',
  'pay',
  'purchase',
  'remove',
  'send',
  'sign out',
  'subscribe',
  'transfer',
  'unsubscribe',
  'wire',
  'withdraw',
]);

/**
 * User extensions to the matcher from `~/.peek/policy.json` (P2 PRD §E.3
 * example). The native host parses the policy file and forwards the diff.
 */
export interface DestructivePolicy {
  /** Terms to add on top of {@link BASE_DESTRUCTIVE_TERMS}. */
  readonly add?: readonly string[];
  /**
   * Terms to remove from the merged list. Removal IS allowed (per the P2 PRD
   * §E.3 example) — users own their consent calculus — but the security review
   * should document the trade-off. We don't silently fail on remove-of-unknown.
   */
  readonly remove?: readonly string[];
}

/**
 * Normalize a user-supplied term: lowercase + trim. Empty / non-string entries
 * are dropped (defense in depth — the policy file is user input).
 */
function normalizeTerm(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const trimmed = t.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Build the effective term list: base ∪ add ∖ remove, all lowercased + trimmed.
 * Pure — call it on every check (cheap, ~15 short strings).
 */
export function effectiveDestructiveTerms(policy?: DestructivePolicy): readonly string[] {
  const set = new Set<string>(BASE_DESTRUCTIVE_TERMS);
  for (const raw of policy?.add ?? []) {
    const t = normalizeTerm(raw);
    if (t) set.add(t);
  }
  // Order: add then remove → user's remove[] wins ties with their add[].
  // Rationale: explicit opt-out should override accidental re-additions.
  for (const raw of policy?.remove ?? []) {
    const t = normalizeTerm(raw);
    if (t) set.delete(t);
  }
  return [...set];
}

/**
 * The candidate signals fetched from a DOM element at dispatch time. The
 * MAIN-world dispatcher resolves these by:
 *   - `text`         = the trimmed innerText / textContent / value
 *   - `ariaLabel`    = `getAttribute('aria-label')`
 *   - `nearbyHeading` = the closest ancestor's section/legend/h{1..6} text
 */
export interface DestructiveCandidate {
  readonly text?: string | null;
  readonly ariaLabel?: string | null;
  readonly nearbyHeading?: string | null;
}

export interface DestructiveMatchResult {
  /** Was a destructive term found? */
  readonly matched: boolean;
  /** The exact term that matched (for the audit log / banner copy). */
  readonly term?: string;
  /** Which candidate field matched (for telemetry / debugging). */
  readonly field?: 'text' | 'ariaLabel' | 'nearbyHeading';
}

/**
 * Test whether the candidate is destructive given the effective term list.
 *
 * Returns the FIRST match (term, field). We don't need to enumerate every
 * possible match — the override is binary. The match is case-insensitive
 * substring; see the module docstring for why we don't use word boundaries.
 */
export function matchDestructive(
  candidate: DestructiveCandidate,
  terms: readonly string[] = BASE_DESTRUCTIVE_TERMS,
): DestructiveMatchResult {
  const fields: Array<{ field: 'text' | 'ariaLabel' | 'nearbyHeading'; value: string | null }> = [
    { field: 'text', value: candidate.text ?? null },
    { field: 'ariaLabel', value: candidate.ariaLabel ?? null },
    { field: 'nearbyHeading', value: candidate.nearbyHeading ?? null },
  ];

  // Sort terms by length descending so superstrings like "unsubscribe" beat
  // "subscribe" and "cancel subscription" beats "subscribe": the matcher
  // reports the most specific term that fired, which is what the banner / audit
  // log want. Sorting ~15 strings on every call is negligible.
  const sortedTerms = terms
    .filter((t) => t.length > 0)
    .slice()
    .sort((a, b) => b.length - a.length);

  for (const { field, value } of fields) {
    if (value === null || value === undefined) continue;
    const lower = value.toLowerCase();
    for (const term of sortedTerms) {
      if (lower.includes(term)) {
        return { matched: true, term, field };
      }
    }
  }

  return { matched: false };
}

/**
 * Convenience: matchDestructive with the {@link effectiveDestructiveTerms}
 * computed inline. Use the explicit form when you need the merged term list
 * (e.g. to surface in the audit log).
 */
export function isDestructive(
  candidate: DestructiveCandidate,
  policy?: DestructivePolicy,
): DestructiveMatchResult {
  return matchDestructive(candidate, effectiveDestructiveTerms(policy));
}
