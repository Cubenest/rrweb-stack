---
title: "Generate a Playwright repro from a real browser session"
lede: "When I just hit a bug by clicking around, I want an automated regression test before I forget how I did it."
description: "Turn a recorded peek session into a runnable Playwright spec by asking your agent to call generate_playwright_repro. Lock in the repro before you forget."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [claude-code, cursor, playwright]
relatedRecipes: [claude-code-on-staging, security-review-flow-with-ai-agent, use-peek-with-per-action-approval]
---

## What you'll end up with

A `.spec.ts` file in your repo with the exact click sequence, form input, and waits you just performed — derived from peek's user-action timeline, not hand-typed. Run it with `npx playwright test` to confirm the bug is captured.

![Generated Playwright spec next to the peek session it came from](/recipes/assets/generate-playwright-repro-from-real-browser-session.png)

## Prerequisites

- A recent install of Claude Code (CLI or VS Code extension) or Cursor with MCP enabled
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- Playwright installed in your repo (`npm i -D @playwright/test`)

## Steps

### 1. Install peek

```bash
npm i -g @peekdev/cli
peek init
```

`peek init` writes the MCP server entry into `~/.claude.json` (and offers to do the same for Cursor / Windsurf if it detects them).

### 2. Capture the bug

Open the broken page in Chrome. Click the peek toolbar icon → **Capture this tab**. Reproduce the bug end-to-end — click the buttons, fill the forms, watch it fail. Stop the capture.

### 3. Ask your agent to generate the spec

In Claude Code or Cursor:

> Take my most recent peek session and call `generate_playwright_repro` on it. Save the output to `tests/e2e/regression-place-order.spec.ts`.

The agent calls `list_recent_sessions` to find the latest session ID, then `generate_playwright_repro` with that session — peek returns a `.spec.ts` body assembled from the recorded user actions and network expectations.

### 4. Run it

```bash
npx playwright test tests/e2e/regression-place-order.spec.ts
```

The spec should reproduce the bug. Commit it as your regression test.

## Why this works

peek's recorder timestamps every meaningful user action — clicks, key presses, form submits — and pairs them with the network calls each one triggers. `generate_playwright_repro` walks that timeline and emits a deterministic test that asserts the same call shape your real session produced.

## Next steps

- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
- [Understand peek's per-action approval model for sensitive flows](/recipes/use-peek-with-per-action-approval)
