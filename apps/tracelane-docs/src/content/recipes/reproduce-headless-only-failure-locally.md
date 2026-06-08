---
title: "Reproduce a headless-only test failure locally"
lede: "When a test passes headed but fails headless, I want to see what the headless browser actually rendered without staring at a blank screen."
description: "Run the failing spec under headless WebdriverIO with the tracelane service on, then scrub the HTML replay to see what headless Chrome actually rendered."
type: short
status: published
publishedAt: 2026-06-15
integrations: [webdriverio, headless]
relatedRecipes: [debug-flaky-checkout-test-in-ci, add-tracelane-to-webdriverio-in-5-minutes, share-failing-test-with-a-developer]
---

## What you'll end up with

A `tracelane-report-<spec>.html` produced by a local headless run that reproduces your CI failure. You scrub through the replay and see the missing font, the off-screen modal, or the viewport-dependent layout that only the headless browser hit.

![Headless rrweb replay reproducing a CI failure](/recipes/assets/reproduce-headless-only-failure-locally.png)

## Prerequisites

- An existing WebdriverIO suite with `@tracelane/wdio` installed
- Local Chrome (or Chromium) on your machine
- Node >= 22

## Steps

### 1. Confirm the service is wired in

```ts
import { tracelaneService } from '@tracelane/wdio';

export const config = {
  services: [tracelaneService()],
  // ... your existing config
};
```

### 2. Force the same headless mode CI uses

```ts
capabilities: [{
  browserName: 'chrome',
  'goog:chromeOptions': {
    args: ['--headless=new', '--window-size=1280,720'],
  },
}],
```

Match CI's `--window-size` exactly — viewport-dependent regressions hide behind any other resolution.

### 3. Run the offending spec

```bash
npx wdio run wdio.conf.ts --spec specs/checkout.spec.ts
```

### 4. Open the report

Open `tracelane-report-checkout.html`. You can see the rendered DOM the headless browser produced, frame-by-frame, even though there was no display to watch.

## Why this works

rrweb captures DOM state from inside the page, so the recording is identical whether the browser had a visible chrome window or not. The HTML report replays that DOM in your normal browser — so you "watch" the headless run after the fact.

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
