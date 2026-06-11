import type { SecurityFinding, Severity } from '../index.js';
import type { ResponseMeta } from '../response-meta.js';

const HEADERS: { name: string; severity: Severity; label: string }[] = [
  { name: 'content-security-policy', severity: 'high', label: 'Content-Security-Policy' },
  {
    name: 'strict-transport-security',
    severity: 'medium',
    label: 'Strict-Transport-Security (HSTS)',
  },
  { name: 'x-frame-options', severity: 'medium', label: 'X-Frame-Options' },
  { name: 'x-content-type-options', severity: 'medium', label: 'X-Content-Type-Options' },
  { name: 'referrer-policy', severity: 'low', label: 'Referrer-Policy' },
];

export function detectMissingHeaders(metas: readonly ResponseMeta[]): SecurityFinding[] {
  const main = metas.find((m) => m.isMainDocument);
  if (!main) return [];
  // HTTPS gate: header/HSTS checks are moot + noisy on non-HTTPS (localhost/non-prod).
  if (!main.url.startsWith('https://')) return [];
  const present = new Set(main.presentSecurityHeaders.map((h) => h.toLowerCase()));
  const out: SecurityFinding[] = [];
  for (const h of HEADERS) {
    if (present.has(h.name)) continue;
    out.push({
      id: `missing-security-header:${h.name}`,
      signal: 'missing-security-header',
      severity: h.severity,
      title: `Missing ${h.label} header`,
      detail: `The main document response did not set the ${h.label} header.`,
      evidence: h.name,
      advisory: true,
    });
  }
  return out;
}
