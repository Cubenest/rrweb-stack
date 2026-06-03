// The auto-fixture (P1 PRD §B.2). Importing `{ test }` from this module and
// using it in place of `@playwright/test`'s `test` opts every test into the
// recorder lifecycle automatically — no per-test wiring. The fixture is `auto`
// (runs even when not explicitly requested) and `box`ed (hidden from the
// Playwright trace/reporter UI so it doesn't clutter the run).
//
// The fixture straddles `use()`: it starts capture BEFORE the test body runs,
// yields with `use()`, then finalizes + writes the report AFTER. This is the
// only place with a live `page` + `testInfo`, which is why the report build
// lives here (the Reporter owns only config: validation + the options→env bridge).

import { test as base, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { loadRrwebBundle } from '@tracelane/core';
import { resolveOptions } from './options.js';
import { type StartedSession, runFinalize, runStart } from './playwright-session.js';

/** Loads the rrweb bundle; injectable so unit tests can pass a stub. */
export type BundleLoader = () => string;

const defaultBundleLoader: BundleLoader = () => loadRrwebBundle(import.meta.url);

/**
 * The fixture implementation, factored out so it is unit-testable without the
 * Playwright runner. `bundleLoader` defaults to reading the package's built
 * dist/rrweb-bundle.js; tests pass a stub to avoid the on-disk dependency.
 */
export async function tracelaneFixture(
  { page }: { page: Page },
  use: () => Promise<void>,
  testInfo: TestInfo,
  bundleLoader: BundleLoader = defaultBundleLoader,
): Promise<void> {
  const options = resolveOptions({});
  const rrwebBundle = bundleLoader();
  let session: StartedSession | undefined;
  try {
    session = await runStart({ page, options, rrwebBundle });
    // Run the test body.
    await use();
  } finally {
    if (session) {
      await runFinalize(session, { page, testInfo, options, rrwebBundle });
    }
  }
}

/**
 * A drop-in replacement for `@playwright/test`'s `test`, with an `auto` tracelane
 * fixture that records every test and writes a report on failure.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a `void` fixture value is Playwright's idiom for an auto-fixture that yields nothing via use()
export const test = base.extend<{ tracelane: void }>({
  tracelane: [
    async ({ page }, use, testInfo) => {
      await tracelaneFixture({ page }, use, testInfo);
    },
    { auto: true, scope: 'test', box: true },
  ],
});

export { expect };
