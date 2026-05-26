// Compatibility matrix — Task 1.11 test suite.
//
// The matrix is a published quick-reference for both products
// (tracelane + peek) per ADR-0002. These tests are the shape-and-shape
// only contract: every entry has the right fields, the right types,
// the right enums, and the markdown mirror doesn't drift from the
// TypeScript source. The qualitative claims in `notes` are reviewed by
// humans during PRs, not asserted by tests.
//
// What we deliberately don't test:
//   - Whether the qualitative claims in `notes` are still accurate —
//     that's the job of the `lastVerified` discipline + Changesets PR
//     review.
//   - Whether the URLs actually resolve / 200 — they're identifiers,
//     not real fetch targets.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { COMPATIBILITY_MATRIX } from '../src/compat';
import type { CompatEntry } from '../src/compat';

// `import.meta.url` is the ESM-safe replacement for `__dirname`; the
// package is declared `"type": "module"` so CommonJS globals aren't
// available.
const here = dirname(fileURLToPath(import.meta.url));

// ────────────────────────────────────────────────────────────────────────────
// Documented enums — keep these in lock-step with the `CompatEntry`
// interface in `src/compat/index.ts`. If the interface gains a new
// category/status, add it here and the tests will keep passing.
// ────────────────────────────────────────────────────────────────────────────

const CATEGORIES: ReadonlySet<CompatEntry['category']> = new Set([
  'developer-tools',
  'spa-framework',
  'rich-text-editor',
  'video-streaming',
  'canvas-webgl',
  'chat-messaging',
  'email-webmail',
  'docs-collaboration',
  'social-feed',
  'commerce',
  'auth-flow',
  'iframe-heavy',
  'pdf-viewer',
  'other',
]);

const STATUSES: ReadonlySet<CompatEntry['status']> = new Set(['good', 'caveats', 'poor']);

const NOTES_MAX_CHARS = 240;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ────────────────────────────────────────────────────────────────────────────
// Shape + content invariants
// ────────────────────────────────────────────────────────────────────────────

describe('COMPATIBILITY_MATRIX', () => {
  test('has at least 10 entries (v0.1 seed)', () => {
    expect(COMPATIBILITY_MATRIX.length).toBeGreaterThanOrEqual(10);
  });

  test('has at least 5 entries with status "good"', () => {
    const good = COMPATIBILITY_MATRIX.filter((e) => e.status === 'good');
    expect(good.length).toBeGreaterThanOrEqual(5);
  });

  test('has at least 3 entries with status in {caveats, poor}', () => {
    const limited = COMPATIBILITY_MATRIX.filter(
      (e) => e.status === 'caveats' || e.status === 'poor',
    );
    expect(limited.length).toBeGreaterThanOrEqual(3);
  });

  test('every entry has all required fields with the right primitive types', () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(typeof entry.url).toBe('string');
      expect(typeof entry.category).toBe('string');
      expect(typeof entry.status).toBe('string');
      expect(typeof entry.notes).toBe('string');
      expect(typeof entry.lastVerified).toBe('string');
    }
  });

  test('every entry has a url that is non-empty and trimmed', () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(entry.url.length).toBeGreaterThan(0);
      expect(entry.url).toBe(entry.url.trim());
    }
  });

  test("every entry's category is one of the documented union values", () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(CATEGORIES.has(entry.category)).toBe(true);
    }
  });

  test("every entry's status is one of {good, caveats, poor}", () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(STATUSES.has(entry.status)).toBe(true);
    }
  });

  test("every entry's notes is non-empty and < 240 chars", () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(entry.notes.length).toBeGreaterThan(0);
      expect(entry.notes.length).toBeLessThan(NOTES_MAX_CHARS);
    }
  });

  test("every entry's lastVerified is a YYYY-MM-DD date", () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(entry.lastVerified).toMatch(ISO_DATE);
    }
  });

  test('the matrix array itself is frozen', () => {
    expect(Object.isFrozen(COMPATIBILITY_MATRIX)).toBe(true);
  });

  test('every entry object is frozen (defence-in-depth vs the readonly type)', () => {
    for (const entry of COMPATIBILITY_MATRIX) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  test('no duplicate URLs', () => {
    const urls = COMPATIBILITY_MATRIX.map((e) => e.url);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Markdown mirror — drift-free guard.
//
// Per IMPLEMENTATION_PLAN.md Task 1.11 Step 3, the markdown is
// "auto-checked-in-CI as drift-free vs the typed source." We parse the
// table rows out of COMPATIBILITY.md and assert URL + status match the
// TypeScript source row-for-row. The notes column is intentionally not
// asserted character-for-character (markdown pipe escaping makes that
// brittle); URL + status are sufficient to catch the common drift
// failure modes (someone edits one source and forgets the other).
// ────────────────────────────────────────────────────────────────────────────

describe('COMPATIBILITY.md mirror', () => {
  const mdPath = resolve(here, '..', 'COMPATIBILITY.md');
  const md = readFileSync(mdPath, 'utf8');

  /**
   * Parse the matrix rows out of the markdown. Looks for table rows
   * shaped `| url | category | status | notes |` and skips the header
   * + divider rows. Returns rows in document order.
   */
  function parseMatrixRows(source: string): Array<{
    url: string;
    category: string;
    status: string;
  }> {
    const rows: Array<{ url: string; category: string; status: string }> = [];
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) continue;
      // Skip header (contains "URL") and divider (contains only `-`/`|`/whitespace).
      if (/^\|\s*url\s*\|/i.test(trimmed)) continue;
      if (/^\|[\s\-|]+\|$/.test(trimmed)) continue;

      const cells = trimmed
        .slice(1, -1) // strip leading/trailing `|`
        .split('|')
        .map((c) => c.trim());
      if (cells.length < 4) continue;
      const [url, category, status] = cells;
      // Cells are guaranteed defined by the length check above; this is for TS narrowing.
      if (!url || !category || !status) continue;
      // Sanity: only push rows whose status looks like one of ours, so we
      // don't accidentally swallow rows from other tables that might be
      // added later.
      if (!STATUSES.has(status as CompatEntry['status'])) continue;
      rows.push({ url, category, status });
    }
    return rows;
  }

  const parsed = parseMatrixRows(md);

  test('markdown table has the same number of entries as the typed source', () => {
    expect(parsed.length).toBe(COMPATIBILITY_MATRIX.length);
  });

  test('markdown table URLs match the typed source row-for-row', () => {
    for (let i = 0; i < COMPATIBILITY_MATRIX.length; i++) {
      const tsEntry = COMPATIBILITY_MATRIX[i];
      const mdRow = parsed[i];
      expect(mdRow, `markdown row ${i} missing`).toBeDefined();
      expect(mdRow?.url).toBe(tsEntry?.url);
    }
  });

  test('markdown table status column matches the typed source row-for-row', () => {
    for (let i = 0; i < COMPATIBILITY_MATRIX.length; i++) {
      const tsEntry = COMPATIBILITY_MATRIX[i];
      const mdRow = parsed[i];
      expect(mdRow, `markdown row ${i} missing`).toBeDefined();
      expect(mdRow?.status).toBe(tsEntry?.status);
    }
  });

  test('markdown table category column matches the typed source row-for-row', () => {
    for (let i = 0; i < COMPATIBILITY_MATRIX.length; i++) {
      const tsEntry = COMPATIBILITY_MATRIX[i];
      const mdRow = parsed[i];
      expect(mdRow, `markdown row ${i} missing`).toBeDefined();
      expect(mdRow?.category).toBe(tsEntry?.category);
    }
  });
});
