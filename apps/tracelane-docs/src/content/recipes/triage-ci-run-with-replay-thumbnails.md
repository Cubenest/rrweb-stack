---
title: "Triage a CI run with 200+ failures using replay thumbnails"
lede: "When a big nightly suite goes red across hundreds of specs, I want a visual index so I can spot the one real bug among the cascade of side-effects."
description: "Generate a tracelane index page that renders a preview thumbnail of every failure's rrweb replay so you can triage by scanning, not clicking."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [ci, github-actions]
relatedRecipes: [debug-flaky-checkout-test-in-ci, add-tracelane-to-webdriverio-in-5-minutes, share-failing-test-with-a-developer]
---

## What you'll end up with

A single `tracelane-index.html` that lists every failing spec with a thumbnail of the final replay frame. You scan the grid, spot the three that look like a real bug instead of a downstream cascade, and ignore the rest.

![Tracelane failure index with replay thumbnails](/recipes/assets/triage-ci-run-with-replay-thumbnails.png)

## Prerequisites

- A WebdriverIO suite already producing `tracelane-report-*.html` files
- The `@tracelane/cli` installed in the project
- Node >= 20

## Steps

### 1. Install the CLI

```bash
npm i -D @tracelane/cli@0.1.0-alpha.7
```

### 2. Build the index after your test run

Add a post-test step that points the CLI at the directory of HTML reports.

```bash
npx tracelane index ./tracelane-out --out ./tracelane-out/index.html
```

### 3. Upload the whole directory as one artifact

```yaml
- name: Upload tracelane bundle
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: tracelane-bundle
    path: tracelane-out/
```

### 4. Open the index

Download the artifact, open `index.html`, and triage. Each thumbnail is a click-through to its full replay.

## Why this works

The CLI walks the output directory, extracts the last meaningful rrweb frame from each report, and renders a static grid. The index is just HTML + inline SVG, so it ships inside the same artifact and works offline.

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
