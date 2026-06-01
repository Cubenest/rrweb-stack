// Unit tests for the index renderer.

import { describe, expect, it } from 'vitest';
import type { IndexEntry } from '../src/lib/render-index.js';
import { renderIndex } from '../src/lib/render-index.js';

const FIXED_DATE = new Date('2026-06-01T10:00:00.000Z');

function entry(
  filename: string,
  overrides: Partial<NonNullable<IndexEntry['meta']>> = {},
): IndexEntry {
  return {
    filename,
    meta: {
      title: overrides.title ?? 'A test',
      status: overrides.status ?? 'failed',
      ...overrides,
    },
  };
}

describe('renderIndex', () => {
  it('renders a card per entry and links via the relative filename', () => {
    const html = renderIndex({
      entries: [
        entry('report-a.html', {
          title: 'login flow',
          spec: 'tests/login.spec.ts',
          status: 'failed',
        }),
        entry('report-b.html', {
          title: 'checkout flow',
          spec: 'tests/checkout.spec.ts',
          status: 'failed',
        }),
      ],
      generatedAt: FIXED_DATE,
    });

    expect(html).toContain('<title>tracelane index</title>');
    expect(html).toContain('href="report-a.html"');
    expect(html).toContain('href="report-b.html"');
    expect(html).toContain('login flow');
    expect(html).toContain('checkout flow');
    expect(html).toContain('tests/login.spec.ts');
  });

  it('emits a summary line with failed / passed counts', () => {
    const html = renderIndex({
      entries: [
        entry('a.html', { status: 'failed' }),
        entry('b.html', { status: 'failed' }),
        entry('c.html', { status: 'passed' }),
        entry('d.html', { status: 'skipped' }),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(html).toContain('4 reports · 2 failed · 1 passed · 1 skipped');
  });

  it('renders the unparsed card when meta is null', () => {
    const html = renderIndex({
      entries: [{ filename: 'broken.html', meta: null }],
      generatedAt: FIXED_DATE,
    });
    expect(html).toContain('class="card unparsed"');
    expect(html).toContain('href="broken.html"');
    expect(html).toContain('UNPARSED');
  });

  it('escapes HTML in titles and error excerpts', () => {
    const html = renderIndex({
      entries: [
        entry('a.html', {
          title: '<script>alert(1)</script>',
          error: 'oops <img src=x>',
          status: 'failed',
        }),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x>');
  });

  it('does NOT render the error excerpt for a passed test', () => {
    const html = renderIndex({
      entries: [entry('a.html', { status: 'passed', error: 'should not show' })],
      generatedAt: FIXED_DATE,
    });
    expect(html).not.toContain('should not show');
  });

  it('formats duration as ms / s / m+s by magnitude', () => {
    const html = renderIndex({
      entries: [
        entry('fast.html', { durationMs: 250 }),
        entry('mid.html', { durationMs: 12_500 }),
        entry('slow.html', { durationMs: 94_000 }),
      ],
      generatedAt: FIXED_DATE,
    });
    expect(html).toContain('250 ms');
    expect(html).toContain('12.5 s');
    expect(html).toContain('1m 34s');
  });

  it('falls back to em-dash when fields are missing', () => {
    const html = renderIndex({
      entries: [entry('a.html')],
      generatedAt: FIXED_DATE,
    });
    expect(html).toContain('—');
  });

  it('uses a custom title when provided', () => {
    const html = renderIndex({
      entries: [entry('a.html')],
      title: 'PR #42 failures',
      generatedAt: FIXED_DATE,
    });
    expect(html).toContain('<title>PR #42 failures</title>');
    expect(html).toContain('PR #42 failures');
  });

  it('is a complete HTML document', () => {
    const html = renderIndex({ entries: [entry('a.html')], generatedAt: FIXED_DATE });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html.trim().endsWith('</html>')).toBe(true);
  });
});
