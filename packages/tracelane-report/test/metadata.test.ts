import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHero, resolveCiMetadata } from '../src/metadata';
import type { ReportMeta } from '../src/types';

const BASE: ReportMeta = { title: 'a test', status: 'failed' };

// CI provenance env vars this module reads. Cleared before each test so the
// host environment (GitHub Actions sets GITHUB_* on the runner!) can't leak in
// and change what resolveCiMetadata detects. Each test then stubs only the vars
// it is asserting on.
const PROVENANCE_ENV = [
  'GITHUB_SHA',
  'CI_COMMIT_SHA',
  'GITHUB_SERVER_URL',
  'GITHUB_REPOSITORY',
  'GITHUB_RUN_ID',
  'CI_JOB_URL',
  'CI_PIPELINE_URL',
  'BUILD_URL',
];

beforeEach(() => {
  for (const name of PROVENANCE_ENV) vi.stubEnv(name, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveCiMetadata — CI provenance (Task 2.11)', () => {
  it('fills commitSha from GITHUB_SHA when absent', () => {
    vi.stubEnv('GITHUB_SHA', 'deadbeef');
    expect(resolveCiMetadata(BASE).commitSha).toBe('deadbeef');
  });

  it('fills commitSha from CI_COMMIT_SHA (GitLab) when GITHUB_SHA is unset', () => {
    vi.stubEnv('CI_COMMIT_SHA', 'gitlabsha');
    expect(resolveCiMetadata(BASE).commitSha).toBe('gitlabsha');
  });

  it('assembles a GitHub Actions run URL', () => {
    vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
    vi.stubEnv('GITHUB_REPOSITORY', 'Cubenest/rrweb-stack');
    vi.stubEnv('GITHUB_RUN_ID', '123');
    expect(resolveCiMetadata(BASE).buildUrl).toBe(
      'https://github.com/Cubenest/rrweb-stack/actions/runs/123',
    );
  });

  it('uses GitLab CI_JOB_URL when GitHub run pieces are absent', () => {
    vi.stubEnv('CI_JOB_URL', 'https://gitlab/job/9');
    expect(resolveCiMetadata(BASE).buildUrl).toBe('https://gitlab/job/9');
  });

  it('explicit metadata always wins over the environment', () => {
    vi.stubEnv('GITHUB_SHA', 'fromenv');
    vi.stubEnv('CI_JOB_URL', 'https://env/build');
    const resolved = resolveCiMetadata({ ...BASE, commitSha: 'explicit', buildUrl: 'https://x' });
    expect(resolved.commitSha).toBe('explicit');
    expect(resolved.buildUrl).toBe('https://x');
  });

  it('leaves fields undefined when nothing is available', () => {
    // beforeEach already cleared every provenance var.
    const resolved = resolveCiMetadata(BASE);
    expect(resolved.commitSha).toBeUndefined();
    expect(resolved.buildUrl).toBeUndefined();
  });
});

describe('renderHero — editorial postmortem header (Phase 6)', () => {
  const FULL: ReportMeta = {
    spec: 'test/login.spec.ts',
    title: 'logs in',
    status: 'failed',
    error: 'boom',
    durationMs: 4210,
    browserName: 'chrome',
    browserVersion: '124.0',
    viewport: { width: 1280, height: 720 },
    commitSha: 'abc1234',
    buildUrl: 'https://ci/run/1',
  };

  // Pin "Captured" so we don't have a flaky time-dependent assertion.
  const CAPTURED = new Date(Date.UTC(2026, 4, 30, 18, 47, 0));

  it('renders the hero section with eyebrow, headline, error block, and meta strip', () => {
    const html = renderHero(FULL, 2418, CAPTURED);
    // Structure
    expect(html).toContain('<section class="hero">');
    expect(html).toContain('class="eyebrow"');
    expect(html).toContain('<h1 class="what">');
    expect(html).toContain('<pre class="error-message">');
    expect(html).toContain('class="meta-strip"');
    // Content — title + status framing + error
    expect(html).toContain('logs in');
    expect(html).toContain('class="status failed"');
    expect(html).toContain('<em>failed</em>');
    expect(html).toContain('boom');
    // Meta strip + eyebrow values
    expect(html).toContain('test/login.spec.ts');
    expect(html).toContain('chrome 124.0');
    expect(html).toContain('1280×720'); // hero uses × in eyebrow
    expect(html).toContain('<code>abc1234</code>');
    expect(html).toContain('href="https://ci/run/1"');
    expect(html).toContain('4.21 s'); // formatted duration
    // Event count formatted with locale thousands separator
    expect(html).toContain('2,418');
    // Captured timestamp pinned by the passed-in Date
    expect(html).toContain('2026-05-30 18:47 UTC');
  });

  it('omits the error block when no error is supplied and meta strip when no fields', () => {
    const html = renderHero({ title: 'bare', status: 'passed' });
    expect(html).toContain('bare');
    expect(html).not.toContain('class="error-message"');
    // Meta strip always has "Captured" at minimum, so it is present even on a
    // bare meta — but it has just the one item, no spec/commit/build/duration.
    expect(html).toContain('class="meta-strip"');
    expect(html).not.toContain('Spec');
    expect(html).not.toContain('Commit');
    // Status framing per the verb map
    expect(html).toContain('class="status passed"');
    expect(html).toContain('<em>passed</em>');
  });

  it('HTML-escapes title and error so markup cannot be injected', () => {
    const html = renderHero({
      title: '<img src=x onerror=alert(1)>',
      status: 'failed',
      error: '</header><script>evil()</script>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>evil()');
    expect(html).toContain('&lt;img src=x');
  });

  it('formats sub-second and multi-minute durations', () => {
    expect(renderHero({ ...FULL, durationMs: 850 })).toContain('850 ms');
    expect(renderHero({ ...FULL, durationMs: 95_000 })).toContain('1m 35s');
  });

  it('does not render a javascript: build URL as a clickable link', () => {
    const html = renderHero({
      title: 't',
      status: 'failed',
      buildUrl: 'javascript:alert(1)',
    });
    expect(html).not.toMatch(/<a\s+href="javascript:/i);
    expect(html).not.toContain('<a href="javascript:alert(1)"');
    // The value still appears (escaped) as plain text so the report is honest.
    expect(html).toContain('javascript:alert(1)');
  });

  it('renders an http(s) build URL as a clickable link', () => {
    const html = renderHero({ title: 't', status: 'failed', buildUrl: 'https://ci/run/1' });
    expect(html).toContain('<a href="https://ci/run/1">https://ci/run/1</a>');
  });

  it('shows a non-http(s) build URL (e.g. data:) as text, not a link', () => {
    const html = renderHero({
      title: 't',
      status: 'failed',
      buildUrl: 'data:text/html,<b>x',
    });
    expect(html).not.toMatch(/<a\s+href="data:/i);
    expect(html).toContain('data:text/html,&lt;b&gt;x');
  });

  it('uses the right status verb in headline + eyebrow per status', () => {
    expect(renderHero({ title: 't', status: 'passed' })).toContain('<em>passed</em>');
    expect(renderHero({ title: 't', status: 'broken' })).toContain('<em>errored</em>');
    expect(renderHero({ title: 't', status: 'skipped' })).toContain('<em>was skipped</em>');
  });
});

describe('renderHero — tracelane brand mark', () => {
  it('eyebrow contains the tracelane inline SVG mark', () => {
    const html = renderHero({ title: 'login fails', status: 'failed' });
    expect(html).toContain('class="tracelane-mark"');
    expect(html).toContain('aria-label="tracelane"');
    expect(html).toContain('#C2563D');
  });
});
