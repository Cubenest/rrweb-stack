---
title: "Collect tracelane replays across a sharded Playwright run"
lede: "When I shard Playwright across CI machines, I want every shard's failure replays gathered in one place — no merge step."
description: "tracelane writes one HTML per failed test, so a sharded Playwright matrix uploads each shard's reports and a final job gathers them — no merge step."
type: short
status: published
publishedAt: 2026-06-15
integrations: [playwright, ci, sharding]
relatedRecipes: [attach-rrweb-replay-to-every-playwright-pr, triage-ci-run-with-replay-thumbnails]
---

## What you'll end up with

A single downloadable artifact containing every shard's `tracelane-reports/*.html`. Because each failure is already a standalone file, there's nothing to merge — you just collect them.

![Collected tracelane replays from a sharded Playwright matrix](/recipes/assets/collect-playwright-shard-reports-in-ci.png)

## Prerequisites

- A Playwright suite already running sharded in CI (`--shard`)
- `@tracelane/playwright` wired in (see [the 5-minute setup](/recipes/add-tracelane-to-playwright-in-5-minutes))

## Steps

### 1. Upload each shard's reports under a per-shard name

`actions/upload-artifact@v4` forbids two jobs writing the same artifact name, so namespace by shard:

```yaml
  test:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright test --shard=${{ matrix.shard }}/3
      - name: Upload this shard's replays
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: tracelane-reports-${{ matrix.shard }}
          path: tracelane-reports/
          if-no-files-found: ignore
```

### 2. Gather them in a final job

```yaml
  collect:
    needs: test
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - name: Download every shard's replays into one folder
        uses: actions/download-artifact@v4
        with:
          pattern: tracelane-reports-*
          merge-multiple: true
          path: tracelane-reports
      - name: Re-upload the combined set
        uses: actions/upload-artifact@v4
        with:
          name: tracelane-reports
          path: tracelane-reports/
          if-no-files-found: ignore
```

### 3. Open any failure

Download `tracelane-reports`, open any `.html` — each is a complete, offline replay on its own.

## Why this works

tracelane's artifact is per-failure, not a single aggregate report, and filenames carry the Playwright project name + a millisecond timestamp — so parallel workers and shards never collide and **no merge step is required**. `download-artifact`'s `merge-multiple` just flattens the per-shard folders into one.

## Next steps

- [Attach an rrweb replay to every Playwright failure on a PR](/recipes/attach-rrweb-replay-to-every-playwright-pr)
- [Triage a CI run with 200+ failures](/recipes/triage-ci-run-with-replay-thumbnails)
