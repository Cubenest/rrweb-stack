import type { eventWithTime } from '@cubenest/rrweb-core';
import { detectInsecureCookies } from './detectors/insecure-cookies.js';
import { detectMissingHeaders } from './detectors/missing-headers.js';
import { detectMixedContent } from './detectors/mixed-content.js';
import { detectReverseTabnabbing } from './detectors/reverse-tabnabbing.js';
import type { ResponseMeta } from './response-meta.js';
import { scrapeResponseMeta } from './response-meta.js';
import { type Suppression, applySuppressions } from './suppress.js';

export type { Suppression };

/** console.error prefix the capture layer uses for privacy-safe response metadata. */
export const SEC_CONSOLE_PREFIX = '[tracelane.sec]';

/** rrweb Custom event tag the capture layer uses for privacy-safe response metadata. */
export const SEC_EVENT_TAG = 'tracelane.sec';

export type SecuritySignal =
  | 'missing-security-header'
  | 'mixed-content'
  | 'insecure-cookie'
  | 'reverse-tabnabbing';

export type Severity = 'low' | 'medium' | 'high';

export interface SecurityFinding {
  /** stable id, e.g. `${signal}:${evidence}` */
  readonly id: string;
  readonly signal: SecuritySignal;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  readonly evidence: string;
  /** framing invariant — always true; these are advisory, not audit results */
  readonly advisory: true;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Derive advisory security-hygiene findings from a captured event stream.
 * Pure + total: never throws (a failing detector contributes nothing). Findings
 * are advisory only — NOT a security audit/scan/guarantee.
 */
export function analyze(
  events: readonly eventWithTime[],
  opts: { suppress?: readonly Suppression[] } = {},
): SecurityFinding[] {
  const metas = safe<ResponseMeta[]>(() => scrapeResponseMeta(events), []);
  const findings: SecurityFinding[] = [
    ...safe<SecurityFinding[]>(() => detectMissingHeaders(metas), []),
    ...safe<SecurityFinding[]>(() => detectMixedContent(events, metas), []),
    ...safe<SecurityFinding[]>(() => detectInsecureCookies(metas), []),
    ...safe<SecurityFinding[]>(() => detectReverseTabnabbing(events), []),
  ];
  const kept = applySuppressions(findings, opts.suppress ?? []);
  return [...kept].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.signal.localeCompare(b.signal),
  );
}
