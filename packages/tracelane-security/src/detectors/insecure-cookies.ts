import type { SecurityFinding, Severity } from '../index.js';
import type { ResponseMeta } from '../response-meta.js';

const FLAGS: { key: 'secure' | 'httpOnly' | 'sameSite'; label: string; severity: Severity }[] = [
  { key: 'secure', label: 'Secure', severity: 'medium' },
  { key: 'httpOnly', label: 'HttpOnly', severity: 'low' },
  { key: 'sameSite', label: 'SameSite', severity: 'low' },
];

export function detectInsecureCookies(metas: readonly ResponseMeta[]): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const m of metas) {
    for (const c of m.setCookies) {
      for (const f of FLAGS) {
        if (c[f.key]) continue;
        const id = `insecure-cookie:${c.name}:${f.label}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          signal: 'insecure-cookie',
          severity: f.severity,
          title: `Cookie '${c.name}' missing ${f.label}`,
          detail: `Set-Cookie '${c.name}' did not set the ${f.label} attribute.`,
          evidence: `${c.name}:${f.label}`,
          advisory: true,
        });
      }
    }
  }
  return out;
}
