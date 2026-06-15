// Fixture-driven tests for the playwright.config editor. The contract every
// successful edit must satisfy:
//
//   - Source contains exactly one `@tracelane/playwright` reporter entry in
//     the `reporter` array.
//   - The edit is idempotent: re-running against an already-wired config is a
//     no-op (returns `alreadyConfigured: true`).
//
// On unrecognised shapes the editor MUST back out (ok: false) — these tests
// assert the back-out path for adversarial inputs. Unlike WDIO, the editor
// does NOT touch the user's spec files (the fixture-import swap is a manual
// follow-up step); these tests only cover the config edit.

import { describe, expect, it } from 'vitest';
import {
  TRACELANE_REPORTER_ENTRY,
  appendToReporterArray,
  applyPlaywrightEdit,
  findReporterArray,
  hasTracelaneReporter,
  insertReporterKey,
} from '../src/lib/playwright-editor.js';

// ---- Fixtures ---------------------------------------------------------------

const FIXTURE_NO_REPORTER = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
});
`;

const FIXTURE_STRING_REPORTER = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: 'list',
});
`;

const FIXTURE_EMPTY_ARRAY_REPORTER = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [],
});
`;

const FIXTURE_ARRAY_REPORTER = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['html']],
});
`;

const FIXTURE_MULTILINE_ARRAY_REPORTER = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
});
`;

const FIXTURE_EXPORT_DEFAULT_OBJECT = `import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
  testDir: './tests',
  reporter: [['list']],
};

export default config;
`;

const FIXTURE_PLAIN_OBJECT = `export default {
  testDir: './tests',
};
`;

const FIXTURE_ALREADY_CONFIGURED = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['@tracelane/playwright', { mode: 'failed' }]],
});
`;

const FIXTURE_GARBAGE = `// not a playwright config at all
const x = 42;
console.log("hello");
`;

// ---- hasTracelaneReporter ---------------------------------------------------

describe('hasTracelaneReporter', () => {
  it('detects a tuple reporter entry (single quotes)', () => {
    expect(hasTracelaneReporter("reporter: [['@tracelane/playwright', { mode: 'failed' }]]")).toBe(
      true,
    );
  });
  it('detects a bare string reporter entry', () => {
    expect(hasTracelaneReporter("reporter: ['@tracelane/playwright']")).toBe(true);
  });
  it('accepts double quotes', () => {
    expect(hasTracelaneReporter('reporter: [["@tracelane/playwright"]]')).toBe(true);
  });
  it('is false when the reporter is absent', () => {
    expect(hasTracelaneReporter("reporter: [['list'], ['html']]")).toBe(false);
  });
  it('ignores a mention inside a string literal', () => {
    expect(hasTracelaneReporter(`const note = "@tracelane/playwright"; reporter: [['list']]`)).toBe(
      false,
    );
  });
  it('ignores a mention inside a comment', () => {
    expect(
      hasTracelaneReporter(`// reporter: [['@tracelane/playwright']]\nreporter: [['list']]`),
    ).toBe(false);
  });
});

// ---- findReporterArray ------------------------------------------------------

describe('findReporterArray', () => {
  it('finds an empty reporter array', () => {
    const block = findReporterArray(FIXTURE_EMPTY_ARRAY_REPORTER);
    expect(block).toBeDefined();
    expect(block?.inner.trim()).toBe('');
  });

  it('finds an array reporter and captures its inner content', () => {
    const block = findReporterArray(FIXTURE_ARRAY_REPORTER);
    expect(block?.inner.includes("['list']")).toBe(true);
    expect(block?.inner.includes("['html']")).toBe(true);
  });

  it('finds a multiline reporter array (nested bracket counting)', () => {
    const block = findReporterArray(FIXTURE_MULTILINE_ARRAY_REPORTER);
    expect(block).toBeDefined();
    expect(block?.inner.includes("['list']")).toBe(true);
    expect(block?.inner.includes("['html', { open: 'never' }]")).toBe(true);
  });

  it('is undefined when reporter is a bare string (not an array)', () => {
    expect(findReporterArray(FIXTURE_STRING_REPORTER)).toBeUndefined();
  });

  it('is undefined when no reporter key exists', () => {
    expect(findReporterArray(FIXTURE_NO_REPORTER)).toBeUndefined();
  });

  it('does not match `reporter` inside a string literal', () => {
    const src = `const note = "reporter: [stuff]"; export default defineConfig({ reporter: [['x']] });`;
    const block = findReporterArray(src);
    expect(block?.inner.trim()).toBe("['x']");
  });
});

// ---- appendToReporterArray --------------------------------------------------

describe('appendToReporterArray', () => {
  it('appends to a non-empty array', () => {
    const block = findReporterArray(FIXTURE_ARRAY_REPORTER);
    expect(block).toBeDefined();
    if (!block) return;
    const next = appendToReporterArray(FIXTURE_ARRAY_REPORTER, block);
    expect(next).toContain(TRACELANE_REPORTER_ENTRY);
    expect(next).toContain("['list']");
    expect(next).toContain("['html']");
  });

  it('appends as the sole element of an empty array', () => {
    const block = findReporterArray(FIXTURE_EMPTY_ARRAY_REPORTER);
    expect(block).toBeDefined();
    if (!block) return;
    const next = appendToReporterArray(FIXTURE_EMPTY_ARRAY_REPORTER, block);
    expect(next).toContain(`reporter: [${TRACELANE_REPORTER_ENTRY}]`);
  });
});

// ---- insertReporterKey ------------------------------------------------------

describe('insertReporterKey', () => {
  it('inserts a reporter key into a config object without one', () => {
    const next = insertReporterKey(FIXTURE_NO_REPORTER);
    expect(next).toBeDefined();
    expect(next).toContain(`reporter: [${TRACELANE_REPORTER_ENTRY}]`);
    expect(next).toContain("testDir: './tests'");
  });

  it('inserts into a plain `export default {...}` object', () => {
    const next = insertReporterKey(FIXTURE_PLAIN_OBJECT);
    expect(next).toBeDefined();
    expect(next).toContain(`reporter: [${TRACELANE_REPORTER_ENTRY}]`);
  });

  it('returns undefined when no config object literal is found', () => {
    expect(insertReporterKey(FIXTURE_GARBAGE)).toBeUndefined();
  });
});

// ---- applyPlaywrightEdit (end-to-end) ---------------------------------------

describe('applyPlaywrightEdit', () => {
  function expectWired(source: string): void {
    expect(hasTracelaneReporter(source)).toBe(true);
    const matches = source.match(/@tracelane\/playwright/g);
    expect(matches?.length).toBe(1);
  }

  it('wires an array reporter (appends the tracelane entry)', () => {
    const result = applyPlaywrightEdit(FIXTURE_ARRAY_REPORTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyConfigured).toBe(false);
    expectWired(result.source);
  });

  it('wires an empty reporter array', () => {
    const result = applyPlaywrightEdit(FIXTURE_EMPTY_ARRAY_REPORTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectWired(result.source);
  });

  it('wires a multiline reporter array', () => {
    const result = applyPlaywrightEdit(FIXTURE_MULTILINE_ARRAY_REPORTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectWired(result.source);
  });

  it('promotes a bare-string reporter into an array with both entries', () => {
    const result = applyPlaywrightEdit(FIXTURE_STRING_REPORTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectWired(result.source);
    // The original 'list' reporter is preserved.
    expect(result.source).toContain("'list'");
  });

  it('inserts a reporter key when none exists', () => {
    const result = applyPlaywrightEdit(FIXTURE_NO_REPORTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectWired(result.source);
  });

  it('handles the `const config = {...}; export default config` shape', () => {
    const result = applyPlaywrightEdit(FIXTURE_EXPORT_DEFAULT_OBJECT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectWired(result.source);
  });

  it('is idempotent — re-running is a no-op', () => {
    const first = applyPlaywrightEdit(FIXTURE_ARRAY_REPORTER);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyPlaywrightEdit(first.source);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyConfigured).toBe(true);
    expect(second.source).toBe(first.source);
  });

  it('detects an already-configured config as a no-op', () => {
    const result = applyPlaywrightEdit(FIXTURE_ALREADY_CONFIGURED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyConfigured).toBe(true);
    expect(result.source).toBe(FIXTURE_ALREADY_CONFIGURED);
  });

  it('backs out cleanly on garbage (no config object literal)', () => {
    const result = applyPlaywrightEdit(FIXTURE_GARBAGE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.manualSnippet).toContain('@tracelane/playwright');
  });

  it('does not match a `reporter` mention inside a comment when scanning', () => {
    const withComment = `import { defineConfig } from '@playwright/test';

// reporter: [['@tracelane/playwright']]  (example only)
export default defineConfig({
  reporter: [['list']],
});
`;
    const result = applyPlaywrightEdit(withComment);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exactly one REAL tracelane entry (the comment one is stripped).
    const matches = result.source.match(/@tracelane\/playwright/g);
    // The comment example mentions it once; our real edit adds one. So 2 total
    // strings — but only one is a live reporter entry. Assert the live entry.
    expect(hasTracelaneReporter(result.source)).toBe(true);
    expect(matches?.length).toBe(2);
  });
});
