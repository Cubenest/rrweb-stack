// Map Playwright's test outcome to @tracelane/report's ReportStatus + decide
// whether a test counts as "passed" for the recorder's report-build decision.
//
// @tracelane/report's ReportStatus union is 'passed' | 'failed' | 'skipped' |
// 'broken' (verified against @tracelane/report's src/index.ts → types.ts).
// Playwright's TestResult.status is 'passed' | 'failed' | 'timedOut' |
// 'skipped' | 'interrupted'. timedOut/interrupted have no direct member, so we
// map them to 'broken' — the report renders 'broken' as a non-pass that is not
// a plain assertion failure, which matches a timeout/interrupt.

import type { TestInfo } from '@playwright/test';
import type { ReportStatus } from '@tracelane/report';

type PwStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

/** Map a Playwright `TestResult.status` to a report `ReportStatus`. */
export function mapStatus(status: PwStatus): ReportStatus {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'timedOut':
    case 'interrupted':
      return 'broken';
  }
}

/**
 * A test "passed" when its actual status equals its expected status — this is
 * Playwright's own definition (it makes `test.fail()` cases, where the expected
 * status is 'failed', count as a pass). The recorder uses this to decide
 * whether to build a report in 'failed' mode (ADR-0005).
 */
export function isPassed(testInfo: Pick<TestInfo, 'status' | 'expectedStatus'>): boolean {
  return testInfo.status === testInfo.expectedStatus;
}
