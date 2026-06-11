---
title: "Add a replayable HTML report to your WebdriverIO suite in 5 minutes"
lede: "When I already have a WebdriverIO suite, I want session replays on failures without rewriting any of my existing config."
description: "Install the @tracelane/wdio service, add one line to wdio.conf.ts, and ship a single-file HTML replay report on every test failure."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [webdriverio]
relatedRecipes: [debug-flaky-checkout-test-in-ci, share-failing-test-with-a-developer, triage-ci-run-with-replay-thumbnails]
---

## What you'll end up with

A `tracelane-report-<spec>.html` next to your existing WDIO reporter output, generated automatically whenever a spec fails. The file is self-contained — open it in any browser to scrub the rrweb replay, inspect the console, and see failed network requests. On HTTPS pages the report also includes an advisory Security-hygiene panel (see the security-hygiene recipe) flagging things like missing security headers and insecure cookies.

![Tracelane HTML report from a WebdriverIO suite](/recipes/assets/add-tracelane-to-webdriverio-in-5-minutes.png)

## Prerequisites

- An existing WebdriverIO project (v8 or v9)
- Node >= 22

## Steps

### 1. Install the service

```bash
npm i -D @tracelane/wdio@0.1.0-alpha.14
```

### 2. Add it to `wdio.conf.ts`

```ts
import { tracelaneService } from '@tracelane/wdio';

export const config = {
  services: [tracelaneService()],
  // ... your existing config
};
```

That's the entire integration. No reporter changes, no spec rewrites, no environment variables.

### 3. Run your suite

```bash
npx wdio run wdio.conf.ts
```

When a spec fails, the service writes a `tracelane-report-<spec>.html` into your project root.

### 4. Open the report

Open the file in any browser. The rrweb player lives at the top; console and network panels below it are time-synced to the replay scrubber.

## Why this works

The service subscribes to WDIO's `beforeSession` / `afterTest` lifecycle, attaches the framework-agnostic `@tracelane/core` recorder to the running browser, and hands the captured events to `@tracelane/report` to inline into a single HTML file. Pass-tests are discarded immediately; only failures keep their event stream.

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
- [Triage a CI run with 200+ failures](/recipes/triage-ci-run-with-replay-thumbnails)
