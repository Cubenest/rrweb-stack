/** console.error prefix the capture layer uses for privacy-safe response metadata. */
export const SEC_CONSOLE_PREFIX = '[tracelane.sec]';

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
