import type { SecurityFinding } from '../index.js';
import type { ResponseMeta } from '../response-meta.js';

export function detectMixedContent(metas: readonly ResponseMeta[]): SecurityFinding[] {
  const main = metas.find((mt) => mt.isMainDocument);
  if (!main || !main.url.startsWith('https://')) return [];
  const seen = new Set<string>();
  const out: SecurityFinding[] = [];
  for (const mt of metas) {
    if (!mt.url.startsWith('http://') || seen.has(mt.url)) continue;
    seen.add(mt.url);
    out.push({
      id: `mixed-content:${mt.url}`,
      signal: 'mixed-content',
      severity: 'high',
      title: 'Mixed content (HTTP resource on an HTTPS page)',
      detail: `An HTTP resource was loaded by the HTTPS page ${main.url}.`,
      evidence: mt.url,
      advisory: true,
    });
  }
  return out;
}
