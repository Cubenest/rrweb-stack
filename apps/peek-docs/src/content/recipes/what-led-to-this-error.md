---
title: "See the causal chain that led to an error"
lede: "I don't just want the error — I want the story: what I clicked, what the DOM did, and which request failed, in order, right before it broke."
description: "Give your AI agent a console error from a recorded session and get back a causal chain of user actions, DOM changes, and network errors that led to it."
type: short
status: published
publishedAt: 2026-06-29
integrations: [claude-code, cursor]
relatedRecipes: [generate-playwright-repro-from-real-browser-session, security-review-flow-with-ai-agent, claude-code-on-staging]
---

## What you'll end up with

For a chosen error, a single time-ordered timeline — your actions, the DOM mutations, and the network errors in the window before it — plus a short deterministic narrative of how the error was triggered.

## Prerequisites

- Claude Code or Cursor with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
- A recorded session that contains at least one console error

See [Set up peek with Claude Code](/recipes/set-up-peek-with-claude-code) rather than restating the config here.

## Steps

### 1. Pick the error

> List the console errors in my latest peek session.

The agent calls `get_session_console_errors` and you (or it) pick the row `id` that matters.

### 2. Ask for the chain

> For that error, show me the causal chain — what I did, what changed on the page, and what failed, right before it.

The agent passes the `id` to `get_user_action_before_error`. It returns one merged `timeline` (plus grouped `actions`, `domMutations`, and `networkErrors`, the seed `error`, and a `narrative`) for a window before the error.

### 3. Widen or narrow the window

> Widen the window to 10 seconds before the error.

The agent re-calls with a larger `windowMs` to pull in earlier context.

## Why this works

peek doesn't just store the error — it reassembles the events around it from the recorded session, on-device. The chain is pre-merged and ordered, so the agent reasons over "action → DOM change → failed request → error" instead of stitching three separate queries together.

## Good to know

The chain is bounded for signal: it keeps up to the most relevant DOM mutations and network errors in the window and flags `truncated` when there were more — so treat it as the story around the error, not an exhaustive log.

## Next steps

Once you understand the trigger, capture it as a test with [Generate a Playwright repro from a real session](/recipes/generate-playwright-repro-from-real-browser-session).

## Trust & data handling

Read-tier (Level 1): the chain is assembled from your recorded session in `~/.peek`, non-mutating. Local-first: peek uploads nothing — what your MCP client does with the data is up to you. Captured values are masked at record time.
