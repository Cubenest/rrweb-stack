---
title: "Attach an rrweb replay to every Playwright failure on a PR"
lede: "When a PR fails CI, my developer should not have to ask me what happened — the replay should be linked directly from the PR comment."
description: "Wire the tracelane Playwright reporter into GitHub Actions so every failed test posts a comment with a link to its self-contained rrweb replay."
type: hero
status: draft
publishedAt: 2026-06-15
integrations: [playwright, github-actions, ci]
relatedRecipes: [debug-flaky-checkout-test-in-ci, triage-ci-run-with-replay-thumbnails, share-failing-test-with-a-developer]
---

## What you'll end up with

A bot comment on every PR with a failed Playwright run, listing each failing spec and a direct link to its single-file HTML replay. Reviewers click the link, open the report, and scrub to the failure without ever cloning the branch.

![PR comment linking to a tracelane replay](/recipes/assets/attach-rrweb-replay-to-every-playwright-pr.png)

## Prerequisites

- An existing Playwright project (v1.40+)
- A GitHub Actions workflow running that suite
- A workflow with `pull-requests: write` permission
- Node >= 20

> **Status: aspirational.** This recipe depends on `@tracelane/playwright-reporter` and the `Cubenest/upload-report` GitHub Action, which are currently in development. The recipe will land as `published` once both ship. Track progress at [github.com/Cubenest/rrweb-stack/issues](https://github.com/Cubenest/rrweb-stack/issues).

## Steps

### 1. Install the Playwright reporter

```bash
npm i -D @tracelane/playwright-reporter
```

### 2. Register the reporter in `playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@tracelane/playwright-reporter', { outputDir: 'tracelane-out' }],
  ],
});
```

### 3. Upload + comment from GitHub Actions

```yaml
- name: Upload tracelane reports
  if: failure()
  uses: Cubenest/upload-report@v1
  with:
    path: tracelane-out/*.html
    comment-on-pr: true
```

### 4. Push and watch the PR

On the next failed run, the action uploads every `tracelane-report-*.html` as a workflow artifact and posts a single PR comment linking to each replay. Reviewers open the link and see the exact frames leading up to the failure.

## Why this works

The Playwright reporter hooks `onTestEnd`, asks the browser context for the rrweb event stream the recorder has been collecting, and writes a single self-contained HTML per failure. The Action then uses GitHub's artifacts API to host the file and the PR comments API to drop a link — no replay server, no cloud bucket.

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Triage a CI run with 200+ failures](/recipes/triage-ci-run-with-replay-thumbnails)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
