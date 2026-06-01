---
title: "Debug a flaky checkout test that only fails in CI"
lede: "When my checkout E2E passes locally and fails in CI, I want to see exactly what the browser was doing at the moment of failure."
description: "Use the tracelane HTML report to scrub through the rrweb replay, read console errors, and inspect the network panel of a real CI failure."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [webdriverio, github-actions, ci]
artifact: /demo/acme-shop-checkout-failure.html
relatedRecipes: [add-tracelane-to-webdriverio-in-5-minutes, share-failing-test-with-a-developer, reproduce-headless-only-failure-locally]
---

## What you'll end up with

A self-contained `tracelane-report.html` from the failed CI run with the rrweb replay scrubbable to the failure moment, console errors visible in a synced panel, and a network panel showing the request that broke the test. Open it in any browser; no replay server required.

![Tracelane report for a failed checkout test](/recipes/assets/debug-flaky-checkout-test-in-ci.png)

You can poke at a live example here: [acme-shop checkout failure report](/demo/acme-shop-checkout-failure.html).

## Prerequisites

- An existing WebdriverIO project
- A GitHub Actions workflow running that suite
- Node >= 20

## Steps

### 1. Install the WDIO service

```bash
npm i -D @tracelane/wdio@0.1.0-alpha.14
```

### 2. Register the service in `wdio.conf.ts`

```ts
import { tracelaneService } from '@tracelane/wdio';

export const config = {
  services: [tracelaneService()],
  // ... your existing config
};
```

### 3. Upload the report from GitHub Actions

Add an upload step to your workflow so the HTML report is downloadable from the failed run.

```yaml
- name: Upload tracelane report
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: tracelane-report
    path: tracelane-report-*.html
```

### 4. Open the report

Push the change, wait for the next red build, click into the failed job, and download the `tracelane-report` artifact. Open the HTML file in any browser and scrub the replay to the failure moment. Console + network panels stay in sync with the replay timeline.

## Why this works

The WDIO service hooks `afterTest` and `afterCommand`, captures the rrweb event stream plus console + failed-network responses for the failing spec, and inlines the rrweb player + your session data into a single HTML file. There is no SaaS endpoint, no upload, and no replay server — just a static artifact that GitHub Actions can hold onto.

## Next steps

- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
- [Reproduce a headless-only failure locally](/recipes/reproduce-headless-only-failure-locally)
