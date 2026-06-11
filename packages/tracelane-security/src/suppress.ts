import type { SecurityFinding, SecuritySignal } from './index.js';

export interface Suppression {
  signal?: SecuritySignal;
  evidence?: string;
}

export function applySuppressions(
  findings: readonly SecurityFinding[],
  rules: readonly Suppression[],
): SecurityFinding[] {
  if (rules.length === 0) return [...findings];
  return findings.filter(
    (f) =>
      !rules.some(
        (r) =>
          (r.signal !== undefined || r.evidence !== undefined) &&
          (r.signal === undefined || r.signal === f.signal) &&
          (r.evidence === undefined || r.evidence === f.evidence),
      ),
  );
}
