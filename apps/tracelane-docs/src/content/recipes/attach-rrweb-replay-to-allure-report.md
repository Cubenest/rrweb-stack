---
title: "Attach an rrweb replay to your Allure report"
lede: "When my team lives inside Allure, I want the rrweb replay to show up as an attachment on the failing test, not as a separate HTML I have to email around."
description: "Use the @tracelane/allure-attachment adapter to surface the rrweb replay inline as a first-class Allure attachment on every failed step."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [allure, webdriverio]
relatedRecipes: [add-tracelane-to-webdriverio-in-5-minutes, debug-flaky-checkout-test-in-ci, share-failing-test-with-a-developer]
---

## What you'll end up with

Each failed test in your Allure report has a "Session replay" attachment that opens the rrweb player inline, so a reviewer never leaves the Allure UI to see what happened.

![Allure report with an attached rrweb replay](/recipes/assets/attach-rrweb-replay-to-allure-report.png)

## Prerequisites

- An existing WebdriverIO + Allure reporter setup
- The `@tracelane/wdio` service already installed
- Node >= 22

> **Status: aspirational.** This recipe depends on `@tracelane/allure-attachment`, which is currently in development. The recipe will land as `published` once the package ships. Track progress at [github.com/Cubenest/rrweb-stack/issues](https://github.com/Cubenest/rrweb-stack/issues).

## Steps

### 1. Install the attachment adapter

```bash
npm i -D @tracelane/allure-attachment
```

### 2. Wire it alongside the tracelane service

```ts
import { tracelaneService } from '@tracelane/wdio';
import { allureAttachment } from '@tracelane/allure-attachment';

export const config = {
  services: [
    tracelaneService({ onReport: allureAttachment() }),
  ],
  // ... your existing config
};
```

### 3. Run your suite and open Allure

```bash
npx wdio run wdio.conf.ts
npx allure generate allure-results --clean -o allure-report
npx allure open allure-report
```

Failed tests now show a "Session replay" attachment in the Allure step detail.

## Why this works

`@tracelane/wdio` emits a callback when a report is written; the adapter takes that HTML payload, registers it with the running Allure reporter as an `attachment` of type `text/html`, and Allure's UI renders the embedded rrweb player inside its detail pane.

## Next steps

- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
