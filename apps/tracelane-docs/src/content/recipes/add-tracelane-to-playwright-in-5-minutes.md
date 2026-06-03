---
title: "Add a replayable HTML report to your Playwright suite in 5 minutes"
lede: "When I already have a Playwright suite, I want session replays on failures without rewriting any of my specs."
description: "Install @tracelane/playwright, register the reporter, swap one import, and ship a single-file rrweb HTML replay on every Playwright test failure."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [playwright]
relatedRecipes: [attach-rrweb-replay-to-every-playwright-pr, debug-flaky-checkout-test-in-ci, share-failing-test-with-a-developer]
---

## What you'll end up with

An HTML file (e.g. `tracelane-reports/<spec>--<title>--<id>-<ts>.html` — the exact name is illustrative) written automatically whenever a Playwright test fails. The file is self-contained — open it in any browser to scrub the rrweb replay, inspect the console, and see failed (4xx/5xx) network requests. Recording continues across `page.goto` navigations, so multi-page flows replay end to end.

![Tracelane HTML report from a Playwright suite](/recipes/assets/add-tracelane-to-playwright-in-5-minutes.png)

## Prerequisites

- An existing Playwright project (`@playwright/test` >= 1.40)
- Node >= 20

## Steps

### 1. Install

```bash
npm i -D @tracelane/playwright@0.1.0-alpha.2
```

### 2. Register the reporter in `playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@tracelane/playwright', { mode: 'failed', outDir: './tracelane-reports' }],
  ],
});
```

### 3. Use tracelane's `test`/`expect`

A drop-in for `@playwright/test`:

```ts
import { test, expect } from '@tracelane/playwright/fixture';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByRole('heading')).toHaveText('Order complete');
});
```

The fixture is `auto` — every test in files that import this `test` is recorded; nothing else to wire per-test.

### 4. Run and open the report

```bash
npx playwright test
```

On a failing test you get a single `.html` at `./tracelane-reports/…`. Open it in any browser, fully offline — the rrweb player is at the top; console + failed-network panels below are time-synced to the scrubber.

## Why this works

The fixture owns the recording: it injects the rrweb bundle, re-initializes capture on each main-frame navigation (so multi-page flows are continuous), and on failure hands the events to `@tracelane/report` to inline into one HTML file. Failed-network capture uses CDP on Chromium; on Firefox/WebKit it degrades to rrweb + console.

## Next steps

- [Attach an rrweb replay to every Playwright failure on a PR](/recipes/attach-rrweb-replay-to-every-playwright-pr)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
