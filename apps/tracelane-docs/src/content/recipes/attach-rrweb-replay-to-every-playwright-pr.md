---
title: "Attach an rrweb replay to every Playwright failure on a PR"
lede: "When a PR fails CI, my developer should not have to ask me what happened — the replay should be linked directly from the PR run."
description: "Wire @tracelane/playwright into GitHub Actions so every failed test ships a single-file rrweb replay as a downloadable artifact reviewers can open offline."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [playwright, github-actions, ci]
artifact: /demo/playwright-checkout-failure.html
relatedRecipes: [debug-flaky-checkout-test-in-ci, triage-ci-run-with-replay-thumbnails, share-failing-test-with-a-developer]
---

## What you'll end up with

Every failed Playwright run uploads its `tracelane-reports/*.html` as a workflow artifact. A reviewer downloads it, opens the single file in any browser — fully offline — and scrubs the rrweb replay (with the console + failed-network panels) to the exact failure, without cloning the branch.

![Tracelane replay attached to a failed Playwright PR run](/recipes/assets/attach-rrweb-replay-to-every-playwright-pr.png)

## Prerequisites

- An existing Playwright project (`@playwright/test` >= 1.40)
- A GitHub Actions workflow running that suite
- Node >= 22

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

### 3. Use tracelane's `test`/`expect` in your specs

```ts
import { test, expect } from '@tracelane/playwright/fixture';
```

The fixture is `auto` — every test in files that import this `test` is recorded; no per-test wiring.

### 4. Upload the reports from GitHub Actions

```yaml
      - name: Run Playwright tests
        run: npx playwright test
      - name: Upload tracelane replays
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: tracelane-reports
          path: tracelane-reports/
          if-no-files-found: ignore
```

### 5. Push and watch the PR

On the next failed run, open the run's **Artifacts** → download `tracelane-reports` → open the `.html`. The replay opens offline; scrub to the failure, including across page navigations (recording continues through `page.goto`).

## Why this works

The fixture records the run with rrweb (DOM + console + failed-network captured in-page on every browser, enriched by CDP on Chromium) and, on failure, writes one self-contained HTML file per test into `outDir`. `actions/upload-artifact` ships those files as-is — no replay server, no cloud bucket, no `npx playwright show-trace`.

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Triage a CI run with 200+ failures](/recipes/triage-ci-run-with-replay-thumbnails)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
