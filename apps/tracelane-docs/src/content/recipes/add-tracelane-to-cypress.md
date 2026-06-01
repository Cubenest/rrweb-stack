---
title: "Add tracelane to your Cypress suite"
lede: "When my team has standardised on Cypress, I want the same single-file rrweb replay on failure without switching frameworks."
description: "Drop the @tracelane/cypress plugin into cypress.config.ts and ship a self-contained HTML replay on every failed Cypress spec."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [cypress]
relatedRecipes: [add-tracelane-to-webdriverio-in-5-minutes, debug-flaky-checkout-test-in-ci, share-failing-test-with-a-developer]
---

## What you'll end up with

A `tracelane-report-<spec>.html` next to your Cypress output folder, produced on every failed spec. Identical viewer to the WDIO and Playwright variants — same scrubber, same console + network panels.

![Tracelane HTML report from a Cypress run](/recipes/assets/add-tracelane-to-cypress.png)

## Prerequisites

- An existing Cypress project (v13+)
- Node >= 20

> **Status: aspirational.** This recipe depends on `@tracelane/cypress`, which is currently in development. The recipe will land as `published` once the package ships. Track progress at [github.com/Cubenest/rrweb-stack/issues](https://github.com/Cubenest/rrweb-stack/issues).

## Steps

### 1. Install the plugin

```bash
npm i -D @tracelane/cypress
```

### 2. Register it in `cypress.config.ts`

```ts
import { defineConfig } from 'cypress';
import { tracelanePlugin } from '@tracelane/cypress';

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      tracelanePlugin(on, config);
      return config;
    },
  },
});
```

### 3. Run your suite

```bash
npx cypress run
```

When a spec fails, the plugin writes the HTML report into `cypress/tracelane-out/`.

### 4. Open the report

Open the file in any browser — no replay server, no Cypress Cloud subscription required.

## Why this works

The plugin runs in Cypress's Node process, listens for `after:spec`, and asks the browser context for the rrweb event stream the in-browser recorder has been collecting. It hands the stream to `@tracelane/report` to produce the same single-file HTML as the other framework adapters.

## Next steps

- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
