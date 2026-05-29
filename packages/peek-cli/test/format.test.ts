import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { generatePlaywrightRepro } from '@peekdev/mcp/mcp/playwright-repro';
import { describe, expect, it } from 'vitest';
import type { SessionDetail } from '../src/lib/db.js';
import { formatSession, isExportFormat } from '../src/lib/format/index.js';
import { buildAttribution, formatSessionJson, toJsonExport } from '../src/lib/format/json.js';
import { formatSessionMarkdown } from '../src/lib/format/markdown.js';
import { formatSessionPlaywright } from '../src/lib/format/playwright.js';
import { CLI_VERSION } from '../src/version.js';

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
    eventsBlobPath: null,
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
    eventsBlobPath: null,
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
    // Phase 5: session payload moved under `.session`; `_attribution` is the
    // top-level metadata block (underscore convention).
    expect(parsed.session.id).toBe('s_abc123');
    expect(parsed._attribution).toBeDefined();
  });
});

describe('buildAttribution — Phase 5 indirect-virality block', () => {
  it('returns a static block with the correct UTM-tagged URL and CLI version', () => {
    const attr = buildAttribution('json-attribution');
    expect(attr.tool).toBe('peek');
    expect(attr.version).toBe(CLI_VERSION);
    expect(attr.url).toContain('github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp');
    expect(attr.url).toContain('utm_source=peek-export');
    expect(attr.url).toContain('utm_medium=json-attribution');
    expect(attr.url).toContain('utm_campaign=indirect-virality');
    expect(attr.description).toMatch(/peek/i);
    expect(attr.description).toMatch(/MCP/);
  });

  it('uses format-specific utm_medium so json vs markdown click-through can be attributed separately', () => {
    expect(buildAttribution('json-attribution').url).toContain('utm_medium=json-attribution');
    expect(buildAttribution('markdown-attribution').url).toContain(
      'utm_medium=markdown-attribution',
    );
  });
});

describe('formatSessionJson — Phase 5 attribution block', () => {
  it('places `_attribution` first in the serialized output (insertion-order spec)', () => {
    const str = formatSessionJson(DETAIL);
    // First non-`{` JSON key in the pretty-printed output must be `_attribution`.
    const firstKey = str.match(/^{\n\s*"([^"]+)"/m)?.[1];
    expect(firstKey).toBe('_attribution');
  });

  it('embeds the attribution block with the UTM-tagged peek-mcp URL and version', () => {
    const parsed = JSON.parse(formatSessionJson(DETAIL));
    expect(parsed._attribution.tool).toBe('peek');
    expect(parsed._attribution.version).toBe(CLI_VERSION);
    expect(parsed._attribution.url).toContain(
      'github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp',
    );
    expect(parsed._attribution.url).toContain('utm_source=peek-export');
    expect(parsed._attribution.url).toContain('utm_medium=json-attribution');
    expect(parsed._attribution.url).toContain('utm_campaign=indirect-virality');
    expect(parsed._attribution.description).toMatch(/MCP/);
  });

  it('does NOT leak session data into the attribution block (no sessionId, url, timestamps)', () => {
    const parsed = JSON.parse(formatSessionJson(DETAIL));
    const attrJson = JSON.stringify(parsed._attribution);
    expect(attrJson).not.toContain(DETAIL.session.id);
    expect(attrJson).not.toContain('example.com');
    expect(attrJson).not.toContain(DETAIL.session.createdAt);
    expect(attrJson).not.toContain(DETAIL.session.updatedAt);
  });

  it('preserves the existing session payload under the new `session` key', () => {
    const parsed = JSON.parse(formatSessionJson(DETAIL));
    expect(parsed.session.id).toBe('s_abc123');
    expect(parsed.session.origin).toBe('https://example.com');
    expect(parsed.session.errorCount).toBe(3);
    expect(parsed.session.consoleErrors).toHaveLength(2);
  });
});

describe('formatSessionMarkdown — Phase 5 attribution paragraph', () => {
  it('ends with a horizontal-rule + attribution blockquote linking to peek-mcp with UTM tags', () => {
    const md = formatSessionMarkdown(DETAIL);
    // Trailing block: `---` rule, blank line, blockquote referencing peek.
    expect(md).toMatch(
      /\n---\n\n> _Captured with \[peek\]\(https:\/\/github\.com\/Cubenest\/rrweb-stack\/tree\/main\/packages\/peek-mcp\?utm_source=peek-export&utm_medium=markdown-attribution&utm_campaign=indirect-virality\)[^\n]*\n/,
    );
  });

  it('places the attribution AFTER the §C.3 sections (never before them)', () => {
    const md = formatSessionMarkdown(DETAIL);
    const lastSectionIdx = md.lastIndexOf('## Suggested reproduction');
    const attrIdx = md.indexOf('> _Captured with [peek]');
    expect(lastSectionIdx).toBeGreaterThan(-1);
    expect(attrIdx).toBeGreaterThan(lastSectionIdx);
  });

  it('does NOT leak session data into the attribution paragraph', () => {
    const md = formatSessionMarkdown(DETAIL);
    // Isolate the attribution tail (everything after the final `---`).
    const tail = md.split('\n---\n').pop() ?? '';
    expect(tail).toContain('> _Captured with [peek]');
    expect(tail).not.toContain(DETAIL.session.id);
    expect(tail).not.toContain('example.com');
    expect(tail).not.toContain('TypeError');
  });
});

describe('formatSession dispatch', () => {
  it('renders markdown, json, and playwright as ok', () => {
    expect(formatSession(DETAIL, 'markdown').ok).toBe(true);
    expect(formatSession(DETAIL, 'json').ok).toBe(true);
    // K.2 alpha.7 fix: playwright now wires through to the MCP walker even
    // with no blob (empty events → valid `test(...)` shell w/ placeholder).
    expect(formatSession(DETAIL, 'playwright').ok).toBe(true);
  });

  it('returns a not-implemented message for html (a peek-specific replay viewer is deferred)', () => {
    const html = formatSession(DETAIL, 'html');
    expect(html.ok).toBe(false);
    if (!html.ok) expect(html.message).toMatch(/not yet implemented/);
  });
});

describe('formatSessionPlaywright (K.2 alpha.7 — CLI shares MCP walker)', () => {
  it('returns a valid Playwright `test(...)` script even with no blob (empty events shell)', () => {
    const result = formatSession(DETAIL, 'playwright');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Boilerplate emitted by `generatePlaywrightRepro` regardless of input.
      expect(result.content).toContain("import { test, expect } from '@playwright/test'");
      expect(result.content).toContain('test(');
      expect(result.content).toContain('async ({ page }) =>');
      // No blob → walker emits the "no actions" placeholder, not a partial script.
      expect(result.content).toContain('No user actions were recorded');
    }
  });

  it('uses the session title as the test title when available', () => {
    const result = formatSession(DETAIL, 'playwright');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("test('Checkout flow'");
    }
  });

  it('falls back to a session-id-based title when session.title is null', () => {
    const result = formatSession(EMPTY_DETAIL, 'playwright');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain("test('peek session s_empty'");
    }
  });

  // K.2 cross-surface parity (P2 PRD §B3): the CLI's `--format playwright`
  // and the MCP `generate_playwright_repro` tool MUST emit byte-identical
  // output for the same session — the whole point of wiring them to the
  // same walker. The CLI loads the gzipped blob from disk and hands the
  // decoded eventWithTime[] to the same generator the MCP server uses.
  it('produces byte-identical output to the MCP walker for the same session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'peek-cli-pw-parity-'));
    try {
      // A minimal navigation-only event stream (the same shape rrweb emits
      // on a `page.goto`). We don't need a realistic DOM for parity testing —
      // we cast through unknown since this package doesn't depend on the
      // rrweb-core types directly (peek-cli is a thin reader; the type lives
      // in @peekdev/mcp via @cubenest/rrweb-core transitively).
      const events = [
        {
          type: 4,
          data: { href: 'https://example.com/checkout', width: 1280, height: 800 },
          timestamp: 1000,
        },
      ];
      // gzip using node:zlib — fflate (which decompress() uses) reads RFC-1952
      // gzip frames just fine, so we can avoid pulling rrweb-core into the
      // CLI's devDeps. Verified by event-blobs.test.ts.
      const absBlob = join(dir, 's_parity.rrweb.gz');
      writeFileSync(absBlob, gzipSync(Buffer.from(JSON.stringify(events))));

      const detail: SessionDetail = {
        ...DETAIL,
        session: { ...DETAIL.session, eventsBlobPath: absBlob },
      };
      const cliOutput = formatSessionPlaywright(detail, absBlob);
      // The walker takes eventWithTime[] — cast through unknown matches the
      // shape we wrote to the blob.
      const mcpOutput = generatePlaywrightRepro(
        events as unknown as Parameters<typeof generatePlaywrightRepro>[0],
        {
          title: detail.session.title ?? `peek session ${detail.session.id}`,
        },
      );
      expect(cliOutput).toBe(mcpOutput);
      // Sanity: both contain the navigation we emitted.
      expect(cliOutput).toContain("await page.goto('https://example.com/checkout')");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
