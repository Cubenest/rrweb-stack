---
title: "Share a failing test with a developer who lacks your repo"
lede: "When a developer doesn't have the test repo cloned, I want to send them one link that shows the failure end-to-end without asking them to set anything up."
description: "Upload the self-contained tracelane HTML report to a gist or drop it in Slack so anyone can open it in a browser and scrub the replay."
type: short
status: published
publishedAt: 2026-06-15
integrations: [sharing]
relatedRecipes: [debug-flaky-checkout-test-in-ci, add-tracelane-to-webdriverio-in-5-minutes, triage-ci-run-with-replay-thumbnails]
---

## What you'll end up with

A single URL (gist, Slack file, or any static host) that opens the rrweb replay in the recipient's browser. No repo clone, no Docker pull, no Cypress Cloud login.

![Sharing a tracelane report via gist or Slack](/recipes/assets/share-failing-test-with-a-developer.png)

## Prerequisites

- A `tracelane-report-*.html` from a failed run
- A place to host the file (GitHub gist, Slack upload, S3, anywhere serving static HTML)

## Steps

### 1. Find the report

```bash
ls tracelane-report-*.html
```

Each file is fully self-contained — no sibling assets to copy.

### 2. Upload it

Drag the file into Slack, or push it to a gist:

```bash
gh gist create tracelane-report-checkout.html --public
```

GitHub gists render raw HTML when opened through `htmlpreview.github.io` or any static-proxy frontend.

### 3. Send the link

Paste the URL into your bug ticket, Slack DM, or PR comment. The recipient clicks it, the report opens in their browser, and they scrub the replay to the failure.

## Why this works

The report is a single HTML file with the rrweb player, console snapshots, and network panel inlined. There are no `<script src>` references to external CDNs, no fonts to load, no API calls — it works on any static host, including ones that aggressively cache.

## Next steps

- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Triage a CI run with replay thumbnails](/recipes/triage-ci-run-with-replay-thumbnails)
- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
