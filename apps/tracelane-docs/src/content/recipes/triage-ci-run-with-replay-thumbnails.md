---
title: "Triage a CI run with 200+ failures using a single index page"
lede: "When a big nightly suite goes red across hundreds of specs, I want a single scannable index so I can spot the one real bug among the cascade of side-effects."
description: "Generate one scannable index.html listing every failure's title, spec, error, duration, and browser. Click any card to open the full replay."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [ci, github-actions]
relatedRecipes: [debug-flaky-checkout-test-in-ci, add-tracelane-to-webdriverio-in-5-minutes, share-failing-test-with-a-developer]
---

## What you'll end up with

A single `index.html` next to your reports that lists every failing spec as a card — title, spec path, error excerpt, duration, browser, captured timestamp — with the failed ones up top. You scan the grid, spot the three that look like a real bug instead of a downstream cascade, click through to the full replay only for those.

![Tracelane failure index — metadata cards grid](/recipes/assets/triage-ci-run-with-replay-thumbnails.png)

## Prerequisites

- A WebdriverIO suite already producing `tracelane-report-*.html` files
- The `@tracelane/cli` installed in the project (or invoked via `npx`)
- Node >= 20

## Steps

### 1. Install the CLI (or skip and use npx)

```bash
npm i -D @tracelane/cli
```

### 2. Build the index after your test run

Point the CLI at the directory of HTML reports. By default it writes `<dir>/index.html`; use `--out` to write elsewhere.

```bash
npx tracelane index ./tracelane-reports
```

### 3. Upload the whole directory as one artifact

```yaml
- name: Upload tracelane bundle
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: tracelane-bundle
    path: tracelane-reports/
```

### 4. Open the index

Download the artifact, open `index.html`, and triage. Failed tests are sorted to the top by default. Each card is a click-through to its full replay.

## Why this works

The CLI walks the output directory, extracts the metadata each report already embeds (`title`, `spec`, `status`, `error`, `durationMs`, `browser`, captured timestamp), and renders a single self-contained grid. The index is just HTML + inline CSS, so it ships inside the same artifact and works offline.

The grid is sorted with failed tests first, then by capture time descending. Override with `--sort spec` (alphabetical) or `--sort status` (group by outcome).

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
