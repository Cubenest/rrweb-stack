// Unit tests for the report metadata extractor.

import { describe, expect, it } from 'vitest';
import { errorExcerpt, extractMetadata } from '../src/lib/extract-metadata.js';

/** Minimum-viable report fixture — just the bits the extractor reads. */
function buildFixture(
  meta: Record<string, unknown>,
  extras: { captured?: string; events?: string } = {},
): string {
  const metaLine = `const META = ${JSON.stringify(meta)};\n`;
  const captured = extras.captured
    ? `<div class="item"><span class="label">Captured</span><span class="value">${extras.captured}</span></div>`
    : '';
  const events = extras.events
    ? `<div class="item"><span class="label">Events</span><span class="value">${extras.events}</span></div>`
    : '';
  return `<!doctype html><html><head><title>tracelane — ${meta.spec} :: ${meta.title} (${meta.status})</title></head>
<body>
<div class="meta-strip">${captured}${events}</div>
<script>
${metaLine}const EVENTS_GZ_B64 = "...";
const CONSOLE = [];
</script>
</body></html>`;
}

describe('extractMetadata', () => {
  it('extracts every field from a complete META', () => {
    const html = buildFixture(
      {
        spec: 'tests/e2e/checkout.e2e.ts',
        title: 'completes checkout',
        status: 'failed',
        error: 'AssertionError: element not visible',
        durationMs: 12_500,
        browserName: 'chrome',
        browserVersion: '124.0.6367.78',
        viewport: { width: 1440, height: 640 },
        commitSha: '7f3a892',
        buildUrl: 'https://github.com/Cubenest/rrweb-stack/actions/runs/1284',
      },
      { captured: '2026-05-30 15:39 UTC', events: '12' },
    );

    const meta = extractMetadata(html);
    expect(meta).not.toBeNull();
    expect(meta).toEqual({
      spec: 'tests/e2e/checkout.e2e.ts',
      title: 'completes checkout',
      status: 'failed',
      error: 'AssertionError: element not visible',
      durationMs: 12_500,
      browserName: 'chrome',
      browserVersion: '124.0.6367.78',
      viewport: { width: 1440, height: 640 },
      commitSha: '7f3a892',
      buildUrl: 'https://github.com/Cubenest/rrweb-stack/actions/runs/1284',
      capturedAt: '2026-05-30 15:39 UTC',
      eventCount: 12,
    });
  });

  it('returns null when the META line is missing', () => {
    const html = '<html><body>not a tracelane report</body></html>';
    expect(extractMetadata(html)).toBeNull();
  });

  it('returns null when META JSON is malformed', () => {
    const html = `<html><body><script>
const META = {not valid json};
</script></body></html>`;
    expect(extractMetadata(html)).toBeNull();
  });

  it('defaults status to "unknown" for an unrecognized value', () => {
    const html = buildFixture({ title: 'x', status: 'wat' });
    const meta = extractMetadata(html);
    expect(meta?.status).toBe('unknown');
  });

  it('parses Events with comma separators', () => {
    const html = buildFixture({ title: 'x', status: 'failed' }, { events: '1,234' });
    expect(extractMetadata(html)?.eventCount).toBe(1234);
  });

  it('survives reports without Captured / Events items', () => {
    const html = buildFixture({ title: 'x', status: 'failed' });
    const meta = extractMetadata(html);
    expect(meta?.capturedAt).toBeUndefined();
    expect(meta?.eventCount).toBeUndefined();
  });

  it('skips invalid viewport shape', () => {
    const html = buildFixture({
      title: 'x',
      status: 'failed',
      viewport: { width: '1440', height: '640' },
    });
    expect(extractMetadata(html)?.viewport).toBeUndefined();
  });
});

describe('errorExcerpt', () => {
  it('returns the first line of a multi-line error', () => {
    const error =
      'AssertionError: expected X to equal Y\n  at foo (bar.ts:10:5)\n  at baz (qux.ts:20:5)';
    expect(errorExcerpt(error)).toBe('AssertionError: expected X to equal Y');
  });

  it('returns empty string for undefined', () => {
    expect(errorExcerpt(undefined)).toBe('');
  });

  it('truncates with an ellipsis when over the limit', () => {
    const error = 'x'.repeat(200);
    const out = errorExcerpt(error, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });
});
