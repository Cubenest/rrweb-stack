---
title: "Use replays to file a better bug report"
lede: "When I file a bug, I want the dev to be able to reproduce it from one link instead of reading five paragraphs of repro steps."
description: "Attach a tracelane rrweb replay to your Jira or GitHub issue so the bug report becomes 'open the link' instead of a wall of repro steps."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [bug-reporting, jira, github-issues]
relatedRecipes: [share-failing-test-with-a-developer, debug-flaky-checkout-test-in-ci, add-tracelane-to-webdriverio-in-5-minutes]
---

## What you'll end up with

A Jira or GitHub issue whose entire repro section is one link to a tracelane report. The reviewer opens it, scrubs to the failure, and starts debugging — no "can you tell me exactly what you clicked?" round-trip.

![Bug report with a tracelane replay attached](/recipes/assets/file-a-better-bug-report-with-replays.png)

## Prerequisites

- A failing automated test or a manual session you captured with `@tracelane/wdio`
- A bug tracker (Jira, GitHub Issues, Linear — anything that accepts a URL)

## Steps

### 1. Locate the report

```bash
ls tracelane-report-*.html
```

### 2. Host it somewhere the dev can reach

- **GitHub repo:** commit it under `bug-reports/` and link the raw URL.
- **Gist:** `gh gist create tracelane-report-foo.html --public`
- **Slack / Drive / S3:** drop the file and copy the share URL.

(See [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer) for the long version.)

### 3. File the issue with one link

In the bug body:

```markdown
**Repro:** [open the replay](https://gist.example.com/tracelane-report-foo.html)

Scrub to ~00:42 — checkout button disabled even though cart has 2 items.
```

That's it. The dev clicks the link, scrubs to the timestamp you called out, and reproduces the bug visually.

## Why this works

The replay encodes the exact DOM, network, and console state the user (or the test) was in, so the dev gets a deterministic repro rather than a description. Combined with a timestamp, the bug report collapses from "5 paragraphs of context" to "open this link at this second".

## Next steps

- [Share a failing test with a developer](/recipes/share-failing-test-with-a-developer)
- [Debug a flaky checkout test in CI](/recipes/debug-flaky-checkout-test-in-ci)
- [Add tracelane to WebdriverIO in 5 minutes](/recipes/add-tracelane-to-webdriverio-in-5-minutes)
