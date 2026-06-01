---
title: "Catch a visual regression across a test run"
lede: "When a layout-only regression slips past my assertion-based tests, I want to scrub the replay to the frame where the page broke and screenshot it into the ticket."
description: "Use the tracelane report's scrubbable rrweb replay to walk back from the failure timestamp and pinpoint the layout shift no assertion caught."
type: short
status: published
publishedAt: 2026-06-15
integrations: [webdriverio, visual-regression]
relatedRecipes: [add-tracelane-to-webdriverio-in-5-minutes, debug-flaky-checkout-test-in-ci, share-failing-test-with-a-developer]
---

## What you'll end up with

A screenshot of the exact frame where the cart sidebar collapsed, pulled out of the tracelane report's rrweb replay. Open the report, drag the scrubber to the failure timestamp, then step one mutation back at a time until you see the layout shift. Take a screenshot, paste into the bug ticket.

![Tracelane replay scrubbed to a layout regression](/recipes/assets/catch-visual-regression-across-test-run.png)

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

The recorder captures every DOM mutation, not just the assertions, so the layout shift gets recorded even if no `expect` covered it.

### 3. Open the report and drag the scrubber to the failure

```bash
open tracelane-report-cart.html
```

The rrweb player sits at the top of the report. The scrubber lands on the final captured frame (the failure moment) by default. Drag back along the timeline until you see the page in its broken state — usually a few frames before the assertion fired.

### 4. Step back one mutation at a time

Inside the rrweb player, use the seek bar (or arrow-key seek if you've enabled it) to step backward through individual DOM mutations. Watch the right-hand panel: every mutation lights up as you cross its timestamp. Stop on the mutation that caused the layout to break — usually a `style` attribute change, a `className` swap, or a node removal.

### 5. Screenshot + attach to the ticket

Take a screenshot of the player at the broken frame. Drop it into the bug ticket alongside the report URL (see [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer) for how to host the report).

## Why this works

rrweb captures DOM mutations as an event stream rather than discrete screenshots, so the report can reconstruct the page at any tick. The player's scrubber walks that stream. You don't need a separate visual-regression service — the failure moment and every preceding mutation are already in the single-file report.

## Next steps

- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
