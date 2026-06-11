import type { eventWithTime } from '@cubenest/rrweb-core';
import type { SecurityFinding } from '../index.js';
import { collectRoots, walk } from '../serialized-dom.js';

function relIsSafe(rel: unknown): boolean {
  if (typeof rel !== 'string') return false;
  const tokens = rel.toLowerCase().split(/\s+/);
  return tokens.includes('noopener') || tokens.includes('noreferrer');
}

/**
 * Walks rrweb serialized DOM snapshots (FullSnapshot trees + IncrementalSnapshot
 * `adds`) for `<a target="_blank">` links lacking a `rel` of `noopener`/
 * `noreferrer` — the classic reverse-tabnabbing risk. Pure over plain serialized
 * node objects; no DOM API. Dedupes by href; advisory, never an audit result.
 */
export function detectReverseTabnabbing(events: readonly eventWithTime[]): SecurityFinding[] {
  const roots = collectRoots(events);
  const out: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const n of walk(root)) {
      if (n.type !== 2 || n.tagName?.toLowerCase() !== 'a') continue;
      const attrs = n.attributes ?? {};
      const target = typeof attrs.target === 'string' ? attrs.target.toLowerCase() : '';
      if (target !== '_blank' || relIsSafe(attrs.rel)) continue;
      const href = typeof attrs.href === 'string' ? attrs.href : '(no href)';
      const id = `reverse-tabnabbing:${href}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        signal: 'reverse-tabnabbing',
        severity: 'medium',
        title: 'Reverse tabnabbing risk (target="_blank" without rel="noopener")',
        detail: `An <a target="_blank"> link (${href}) is missing rel="noopener"/"noreferrer".`,
        evidence: href,
        advisory: true,
      });
    }
  }
  return out;
}
