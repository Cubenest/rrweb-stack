import type { SecurityFinding } from '@tracelane/security';
import { describe, expect, it } from 'vitest';
import { type ReportTemplateData, renderReportHtml } from '../src/template';
import type { ReportMeta } from '../src/types';

const META: ReportMeta = {
  spec: 'test/login.spec.ts',
  title: 'logs in',
  status: 'failed',
};

function baseData(overrides: Partial<ReportTemplateData> = {}): ReportTemplateData {
  return {
    meta: META,
    eventsGzB64: '',
    console: [],
    network: [],
    security: [],
    markdown: '## Failing test\n',
    pruned: false,
    eventCount: 0,
    firstTs: 0,
    lastTs: 0,
    ...overrides,
  };
}

const FINDING: SecurityFinding = {
  id: 'missing-security-header:content-security-policy',
  signal: 'missing-security-header',
  severity: 'medium',
  title: 'Missing Content-Security-Policy',
  detail: 'The main document response had no Content-Security-Policy header.',
  evidence: 'https://app.test/',
  advisory: true,
};

describe('renderReportHtml — advisory security panel (Task 12)', () => {
  it('renders the security tab + pane and a finding when findings are present', () => {
    const html = renderReportHtml(baseData({ security: [FINDING] }));
    // Tab + pane markers present.
    expect(html).toContain('id="tab-security"');
    expect(html).toContain('id="pane-security"');
    expect(html).toContain('id="security-rows"');
    // The advisory framing subtitle.
    expect(html).toContain(
      'Observed during the test run — advisory hygiene signals, not a security audit.',
    );
    // The finding is embedded for the in-page bootstrap (SECURITY const).
    expect(html).toContain('const SECURITY =');
    expect(html).toContain('Missing Content-Security-Policy');
    // The in-page render function exists.
    expect(html).toContain('function renderSecurity(');
  });

  it('omits the security tab + pane entirely when there are no findings', () => {
    const html = renderReportHtml(baseData({ security: [] }));
    expect(html).not.toContain('id="tab-security"');
    expect(html).not.toContain('id="pane-security"');
    // The SECURITY payload is still emitted (as an empty array) but no panel.
    expect(html).toContain('const SECURITY = [];');
  });
});
