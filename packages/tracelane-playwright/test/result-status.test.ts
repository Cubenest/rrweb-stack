import { describe, expect, it } from 'vitest';
import { isPassed, mapStatus } from '../src/result-status.js';

// Map Playwright's TestResult.status union → @tracelane/report's ReportStatus
// ('passed' | 'failed' | 'skipped' | 'broken'). timedOut/interrupted have no
// direct ReportStatus member, so they map to 'broken' (the report renders it as
// a non-pass that isn't a plain assertion failure).

describe('mapStatus', () => {
  it('maps playwright statuses to ReportStatus', () => {
    expect(mapStatus('passed')).toBe('passed');
    expect(mapStatus('failed')).toBe('failed');
    expect(mapStatus('timedOut')).toBe('broken');
    expect(mapStatus('interrupted')).toBe('broken');
    expect(mapStatus('skipped')).toBe('skipped');
  });
});

describe('isPassed', () => {
  it('is true only when status === expectedStatus', () => {
    expect(isPassed({ status: 'passed', expectedStatus: 'passed' } as never)).toBe(true);
    expect(isPassed({ status: 'failed', expectedStatus: 'passed' } as never)).toBe(false);
    // test.fail(): an expected failure is a pass.
    expect(isPassed({ status: 'failed', expectedStatus: 'failed' } as never)).toBe(true);
    // timedOut against an expected pass is not a pass.
    expect(isPassed({ status: 'timedOut', expectedStatus: 'passed' } as never)).toBe(false);
  });
});
