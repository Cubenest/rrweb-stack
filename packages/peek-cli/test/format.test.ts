import { describe, expect, it } from 'vitest';
import type { SessionDetail } from '../src/lib/db.js';
import { formatSession, isExportFormat } from '../src/lib/format/index.js';
import { formatSessionJson, toJsonExport } from '../src/lib/format/json.js';
import { formatSessionMarkdown } from '../src/lib/format/markdown.js';

const DETAIL: SessionDetail = {
  session: {
    id: 's_abc123',
    createdAt: '2026-05-26T10:00:00.000Z',
    updatedAt: '2026-05-26T10:02:04.000Z',
    url: 'https://example.com/checkout',
    title: 'Checkout flow',
    origin: 'https://example.com',
    userAgent: 'Mozilla/5.0',
    eventCount: 412,
    bytes: 81_920,
    status: 'finalized',
  },
  counts: { consoleErrors: 2, networkErrors: 1 },
  consoleErrors: [
    {
      ts: 1_716_717_720_000,
      level: 'error',
      message: 'TypeError: cannot read x',
      stack: 'at foo (app.js:1)\nat bar (app.js:2)',
      url: 'https://example.com/checkout',
    },
    {
      ts: 1_716_717_721_000,
      level: 'error',
      message: 'second error',
      stack: null,
      url: null,
    },
  ],
  networkErrors: [
    {
      ts: 1_716_717_719_000,
      method: 'POST',
      url: 'https://example.com/api/pay',
      status: 500,
      statusText: 'Internal Server Error',
      resourceType: 'fetch',
      durationMs: 240,
      errorText: null,
    },
  ],
};

const EMPTY_DETAIL: SessionDetail = {
  session: {
    id: 's_empty',
    createdAt: '2026-05-26T10:00:00.000Z',
    updatedAt: '2026-05-26T10:00:00.000Z',
    url: null,
    title: null,
    origin: null,
    userAgent: null,
    eventCount: 0,
    bytes: 0,
    status: 'active',
  },
  counts: { consoleErrors: 0, networkErrors: 0 },
  consoleErrors: [],
  networkErrors: [],
};

describe('formatSessionMarkdown', () => {
  const md = formatSessionMarkdown(DETAIL);

  it('emits the §C.3 section headings in order', () => {
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      'Page',
      'Console errors',
      'Failed requests',
      'User actions before error',
      'Suggested reproduction',
    ]);
  });

  it('includes the session id and page metadata', () => {
    expect(md).toContain('# Peek session s_abc123');
    expect(md).toContain('Title: Checkout flow');
    expect(md).toContain('URL: https://example.com/checkout');
    expect(md).toContain('Origin: https://example.com');
  });

  it('lists console errors with stack indentation', () => {
    expect(md).toContain('`error` 2024-05-26T10:02:00.000Z — TypeError: cannot read x');
    expect(md).toContain('    at foo (app.js:1)');
  });

  it('lists failed requests with method, url, status', () => {
    expect(md).toContain('POST https://example.com/api/pay → 500 (240ms)');
  });

  it('points at the MCP tools for the deferred sections', () => {
    expect(md).toContain('get_user_action_before_error');
    expect(md).toContain('--format playwright');
  });

  it('renders cleanly for an empty session', () => {
    const empty = formatSessionMarkdown(EMPTY_DETAIL);
    expect(empty).toContain('No console errors recorded.');
    expect(empty).toContain('No failed requests recorded.');
    expect(empty).toContain('URL: (unknown)');
  });
});

describe('toJsonExport / formatSessionJson', () => {
  it('mirrors the MCP return field names', () => {
    const json = toJsonExport(DETAIL);
    expect(json.id).toBe('s_abc123');
    expect(json.origin).toBe('https://example.com');
    expect(json.startedAt).toBe('2026-05-26T10:00:00.000Z');
    expect(json.errorCount).toBe(3);
    expect(json.consoleErrors).toHaveLength(2);
    expect(json.networkErrors[0]?.status).toBe(500);
  });

  it('produces parseable JSON with a trailing newline', () => {
    const str = formatSessionJson(DETAIL);
    expect(str.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(str);
    expect(parsed.id).toBe('s_abc123');
  });
});

describe('formatSession dispatch', () => {
  it('renders markdown and json as ok', () => {
    expect(formatSession(DETAIL, 'markdown').ok).toBe(true);
    expect(formatSession(DETAIL, 'json').ok).toBe(true);
  });

  it('returns a not-implemented message for html and playwright', () => {
    const html = formatSession(DETAIL, 'html');
    const pw = formatSession(DETAIL, 'playwright');
    expect(html.ok).toBe(false);
    expect(pw.ok).toBe(false);
    if (!html.ok) expect(html.message).toMatch(/not yet implemented/);
    if (!pw.ok) expect(pw.message).toMatch(/not yet implemented/);
  });
});

describe('isExportFormat', () => {
  it('accepts the four known formats and rejects others', () => {
    expect(isExportFormat('markdown')).toBe(true);
    expect(isExportFormat('json')).toBe(true);
    expect(isExportFormat('html')).toBe(true);
    expect(isExportFormat('playwright')).toBe(true);
    expect(isExportFormat('yaml')).toBe(false);
  });
});
