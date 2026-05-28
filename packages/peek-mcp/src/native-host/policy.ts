// User policy file (`~/.peek/policy.json`) reader — ADR-0010 / P2 PRD §E.3.
//
// The hardcoded destructive blocklist ships in the extension; this module is
// the seam where users add / remove terms via a local JSON file. The native
// host reads this file once at boot (and on each action request — the file is
// tiny + the read is cheap), and forwards the {add, remove} deltas to the SW
// on every action.request so the MAIN-world dispatcher merges them at
// decision time.
//
// Schema:
//   {
//     "destructiveTerms": { "add": ["yeet", "nuke"], "remove": [] },
//     "allowListBySite": { "https://example.com/*": ["click", "type"] }
//   }
//
// Failure modes are all soft: a missing / unreadable / malformed file resolves
// to the empty policy. A loud throw here would lock action execution out
// entirely for users who haven't created the file. Same posture as
// activation/storage's `sanitize` (drop garbage, never throw).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { peekHomeDir } from '../db/open.js';

/** Default location of the user policy file. */
export function policyJsonPath(): string {
  return join(peekHomeDir(), 'policy.json');
}

// Permissive schema: arrays of `unknown` (sanitised post-parse) so a single
// non-string entry doesn't reject the entire add/remove list. The normaliser
// functions below filter mixed input down to clean strings — same posture as
// activation/storage's sanitize() (drop garbage, never throw, never lose the
// whole file to one bad entry).
const PolicySchema = z.object({
  destructiveTerms: z
    .object({
      add: z.array(z.unknown()).optional(),
      remove: z.array(z.unknown()).optional(),
    })
    .optional(),
  allowListBySite: z.record(z.string(), z.unknown()).optional(),
});
export type PeekPolicy = z.infer<typeof PolicySchema>;

export interface DestructivePolicyDelta {
  /** Terms the user wants to ADD to the matcher (lowercased + trimmed). */
  readonly add: readonly string[];
  /** Terms the user wants to REMOVE from the matcher. */
  readonly remove: readonly string[];
}

/** A {origin → action types} allow-list (per P2 PRD §E.3 example). */
// Reserved for Phase 3e site-scoped allow-list gating (see PRD §E.3 + ADR-0010).
// Currently parsed + validated but no consumer reads it for gating decisions.
export interface AllowListBySite {
  readonly [originPattern: string]: readonly string[];
}

export interface LoadedPolicy {
  readonly destructiveTerms: DestructivePolicyDelta;
  readonly allowListBySite: AllowListBySite;
}

/** Empty fallback returned when the file is missing / unreadable / malformed. */
export const EMPTY_POLICY: LoadedPolicy = {
  destructiveTerms: { add: [], remove: [] },
  allowListBySite: {},
};

function normalizeTerms(value: readonly unknown[] | undefined): string[] {
  if (!value) return [];
  const out = new Set<string>();
  for (const t of value) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    out.add(trimmed);
  }
  return [...out];
}

function normalizeAllowList(value: Record<string, unknown> | undefined): AllowListBySite {
  if (!value) return {};
  const out: Record<string, string[]> = {};
  for (const [origin, types] of Object.entries(value)) {
    if (typeof origin !== 'string' || origin.length === 0) continue;
    if (!Array.isArray(types)) continue;
    const cleaned = types.filter((t): t is string => typeof t === 'string' && t.length > 0);
    if (cleaned.length > 0) out[origin] = cleaned;
  }
  return out;
}

/**
 * Parse a raw JSON string into a normalized {@link LoadedPolicy}. Exported
 * separately from `loadPolicy` so the unit tests can exercise the parsing
 * surface without touching the filesystem.
 */
export function parsePolicy(contents: string): LoadedPolicy {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    return EMPTY_POLICY;
  }
  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) return EMPTY_POLICY;
  return {
    destructiveTerms: {
      add: normalizeTerms(parsed.data.destructiveTerms?.add),
      remove: normalizeTerms(parsed.data.destructiveTerms?.remove),
    },
    allowListBySite: normalizeAllowList(parsed.data.allowListBySite),
  };
}

/**
 * Read + parse ~/.peek/policy.json. A missing file / read error / parse error
 * resolves to {@link EMPTY_POLICY}.
 *
 * @param path override the policy path (tests + alternate PEEK_HOME).
 */
export function loadPolicy(path: string = policyJsonPath()): LoadedPolicy {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return EMPTY_POLICY;
  }
  return parsePolicy(contents);
}
