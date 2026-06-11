import type { eventWithTime } from '@cubenest/rrweb-core';
import type { SecurityFinding } from '../index.js';
import type { ResponseMeta } from '../response-meta.js';
import { collectRoots, walk } from '../serialized-dom.js';

/**
 * Walks rrweb serialized DOM snapshots for subresource-loading attributes that
 * point at `http://` on an HTTPS page — the mixed-content risk. Re-sourced from
 * the DOM (like reverse-tabnabbing) because the capture layer only emits a
 * `[tracelane.sec]` meta for the MAIN DOCUMENT, so subresource URLs never reach
 * the meta stream. The HTTPS gate comes from the main-document meta.
 *
 * Scope (kept tight to limit false positives for the MVP):
 *   - the `src` attribute on ANY element (img, script, iframe, video, audio,
 *     source, …),
 *   - the `href` attribute ONLY on `<link>` (stylesheets/preloads). `<a href>`
 *     is a navigation, not a subresource, so it is NOT flagged.
 *   - `srcset` is not parsed.
 * Dedupes by url; advisory, never an audit result.
 */
export function detectMixedContent(
  events: readonly eventWithTime[],
  metas: readonly ResponseMeta[],
): SecurityFinding[] {
  const main = metas.find((mt) => mt.isMainDocument);
  // Mixed content is only meaningful on an HTTPS page.
  if (!main || !main.url.startsWith('https://')) return [];

  const out: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const root of collectRoots(events)) {
    for (const n of walk(root)) {
      if (n.type !== 2) continue;
      const attrs = n.attributes ?? {};
      const tag = n.tagName?.toLowerCase();
      const urls: unknown[] = [attrs.src];
      if (tag === 'link') urls.push(attrs.href);
      for (const u of urls) {
        if (typeof u !== 'string' || !u.startsWith('http://') || seen.has(u)) continue;
        seen.add(u);
        out.push({
          id: `mixed-content:${u}`,
          signal: 'mixed-content',
          severity: 'high',
          title: 'Mixed content (HTTP resource on an HTTPS page)',
          detail: `An HTTP resource (${u}) was loaded by the HTTPS page ${main.url}.`,
          evidence: u,
          advisory: true,
        });
      }
    }
  }
  return out;
}
