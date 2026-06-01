---
title: "Catch a visual regression across a test run"
lede: "When a layout-only regression slips past my assertion-based tests, I want to scrub a filmstrip of the run and spot the before/after frame at a glance."
description: "Use the tracelane report's filmstrip view to scrub DOM snapshots across a test run and surface the exact frame where the layout broke."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [webdriverio, visual-regression]
relatedRecipes: [add-tracelane-to-webdriverio-in-5-minutes, debug-flaky-checkout-test-in-ci, share-failing-test-with-a-developer]
---

## What you'll end up with

A filmstrip view inside the tracelane report showing DOM snapshots across the spec. You scrub left-to-right, spot the frame where the cart sidebar suddenly collapsed, and screenshot it straight into the bug ticket.

![Tracelane filmstrip catching a layout regression](/recipes/assets/catch-visual-regression-across-test-run.png)

## Prerequisites

- An existing WebdriverIO suite with `@tracelane/wdio` already wired in
- A spec that exercises the page where the regression surfaced
- Node >= 20

## Steps

### 1. Confirm the service is installed

```bash
npm ls @tracelane/wdio
```

If it isn't, follow the [WDIO install recipe](/recipes/add-tracelane-to-webdriverio-in-5-minutes) first.

### 2. Re-run the failing spec

```bash
npx wdio run wdio.conf.ts --spec specs/cart.spec.ts
```

The recorder captures every DOM mutation, not just the failing assertion, so the layout shift gets recorded even if no `expect` covered it.

### 3. Open the report and switch to the filmstrip

```bash
open tracelane-report-cart.html
```

In the report's top bar, click "Filmstrip". The view renders one frame per significant DOM change.

### 4. Scrub to the broken frame

Drag the scrubber until the cart sidebar collapses. The frame timestamp is also a deep link into the rrweb player — click it to jump back to the full replay context.

## Why this works

rrweb captures DOM mutations as an event stream rather than discrete screenshots, so the report can reconstruct the page at any tick. The filmstrip is just a sampled rendering of those ticks — no separate visual-regression service required.

## Next steps

- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
