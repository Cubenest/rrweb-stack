import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMetaHeader, resolveCiMetadata } from '../src/metadata';
import type { ReportMeta } from '../src/types';

const BASE: ReportMeta = { title: 'a test', status: 'failed' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveCiMetadata — CI provenance (Task 2.11)', () => {
  it('fills commitSha from GITHUB_SHA when absent', () => {
    vi.stubEnv('GITHUB_SHA', 'deadbeef');
    expect(resolveCiMetadata(BASE).commitSha).toBe('deadbeef');
  });

  it('fills commitSha from CI_COMMIT_SHA (GitLab) when GITHUB_SHA is unset', () => {
    vi.stubEnv('GITHUB_SHA', '');
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
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('CI_COMMIT_SHA', '');
    vi.stubEnv('GITHUB_RUN_ID', '');
    vi.stubEnv('CI_JOB_URL', '');
    vi.stubEnv('CI_PIPELINE_URL', '');
    vi.stubEnv('BUILD_URL', '');
    const resolved = resolveCiMetadata(BASE);
    expect(resolved.commitSha).toBeUndefined();
    expect(resolved.buildUrl).toBeUndefined();
  });
});

describe('renderMetaHeader (Task 2.11)', () => {
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

  it('renders every supplied field', () => {
    const html = renderMetaHeader(FULL);
    expect(html).toContain('logs in');
    expect(html).toContain('class="status failed"');
    expect(html).toContain('test/login.spec.ts');
    expect(html).toContain('chrome 124.0');
    expect(html).toContain('1280 × 720');
    expect(html).toContain('<code>abc1234</code>');
    expect(html).toContain('href="https://ci/run/1"');
    expect(html).toContain('4.21 s'); // formatted duration
    expect(html).toContain('boom');
  });

  it('omits rows for absent fields and the <dl> entirely when none are present', () => {
    const html = renderMetaHeader({ title: 'bare', status: 'passed' });
    expect(html).toContain('bare');
    expect(html).not.toContain('<dl>');
    expect(html).not.toContain('class="error"');
  });

  it('HTML-escapes title and error so markup cannot be injected', () => {
    const html = renderMetaHeader({
      title: '<img src=x onerror=alert(1)>',
      status: 'failed',
      error: '</header><script>evil()</script>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>evil()');
    expect(html).toContain('&lt;img src=x');
  });

  it('formats sub-second and multi-minute durations', () => {
    expect(renderMetaHeader({ ...FULL, durationMs: 850 })).toContain('850 ms');
    expect(renderMetaHeader({ ...FULL, durationMs: 95_000 })).toContain('1m 35s');
  });
});
