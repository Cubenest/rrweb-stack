---
title: "Debug a flaky checkout test that only fails in CI"
lede: "When my checkout E2E test passes locally and fails on the CI runner, help me see exactly what the browser was doing when it failed."
description: "Use the tracelane HTML report to scrub through the rrweb replay, read the console errors, and inspect the network panel of a real CI failure."
type: hero
status: draft
publishedAt: 2026-06-15
integrations: [webdriverio, github-actions, ci]
---

## What you'll end up with

A self-contained `tracelane-report.html` from a real failed CI run with the rrweb replay scrubbable to the failure moment, console errors visible, and network panel showing the 502 that broke the test.

## Prerequisites

- An existing WebdriverIO suite
- Node >= 20
- A GitHub Actions workflow running the suite

## Steps

### 1. Install

```bash
npm i -D @tracelane/wdio
```

### 2. Configure

```ts
// wdio.conf.ts
import { tracelaneService } from '@tracelane/wdio';

export const config = {
  services: [tracelaneService()],
  // ... rest of your config
};
```

### 3. Run

```bash
npm test
```

### 4. Open the artifact

When a test fails, tracelane writes `tracelane-report-*.html` next to the standard report. Open it in any browser.

## Why this works

The WDIO service hooks into the browser session, records every DOM mutation via rrweb, and produces a single-file HTML report on failure. No SaaS, no infrastructure.

## Next steps

- Add tracelane to your Playwright suite
- Share the report URL in a PR comment automatically
