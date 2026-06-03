// E2E smoke spec (Task 12) — FAILS ON PURPOSE.
//
// A failing test is the only thing that makes the auto-fixture (in `failed`
// mode) write a report, so the deliberate `toBe` mismatch below is the healthy
// outcome here. run.mjs tolerates exactly one failing spec and then asserts a
// single .html report was written under e2e-out.
//
// We import { test, expect } from the BUILT dist fixture (../../dist/fixture.js)
// so the smoke exercises the published surface, not the TS source.

import { expect, test } from '../../dist/fixture.js';

// A `file://` URL string (Chromium needs the scheme; a bare path is rejected).
const fixtureUrl = new URL('../fixture.html', import.meta.url).href;

test('captures a failing interaction and writes a report', async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.click('#go');
  // Give the click handler's console + fetch a beat to flow into the recorder.
  // The CDP->in-page console.error->buffer chain for the 404 is async, so a
  // short settle can miss the network line before finalize; 500ms is reliable.
  await page.waitForTimeout(500);
  // Deliberate failure: the title is "tracelane smoke", not "nope".
  await expect(page.locator('#title')).toHaveText('nope');
});
