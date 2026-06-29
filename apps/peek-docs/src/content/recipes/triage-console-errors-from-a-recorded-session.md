---
title: "Triage every console error in a recorded session"
lede: "When something breaks in my browser, I want my agent to list every console error from the recorded session and tell me what I did right before each one."
description: "Have your AI agent list every console error in a recorded peek session, oldest first, then trace any error back to the user action that triggered it."
type: short
status: published
publishedAt: 2026-06-29
integrations: [claude-code, cursor]
relatedRecipes: [generate-playwright-repro-from-real-browser-session, security-review-flow-with-ai-agent, let-cursor-see-real-network-calls]
---

## What you'll end up with

A ranked, time-ordered list of every `console.error` peek captured in a session — and, for any one you pick, the exact user action that preceded it.

## Prerequisites

- Claude Code or Cursor with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
- A recorded session where something misbehaved

See [Set up peek with Claude Code](/recipes/set-up-peek-with-claude-code) or [Set up peek with Cursor](/recipes/set-up-peek-with-cursor) rather than restating the config here.

## Steps

### 1. Point the agent at the session

> List my recent peek sessions and open the one where the checkout page misbehaved.

The agent calls `list_recent_sessions`, then `get_session_summary` for a narrative of that session (it includes error counts at a glance).

### 2. List the console errors

> Show me every console error in that session, oldest first.

The agent calls `get_session_console_errors`. Each row carries a numeric `id`, a timestamp, the level, the message, and a clipped stack — so you get a stable, ordered list, not a scroll-back through a live console.

### 3. Trace one back to its cause

> For console error #3, what did I do right before it?

The agent passes that row's `id` to `get_user_action_before_error`, which returns a causal chain — the user actions, DOM changes, and network errors in the window before the error, merged into one timeline with a short narrative.

## Why this works

peek recorded the real console of your real browser, locally. `get_session_console_errors` gives each error a stable id, and that id is the handle the causal-chain tool uses — so "what broke" and "what I did right before it" are one short hop apart, with no guesswork.

## Next steps

Turn a confirmed error into a runnable regression test with [Generate a Playwright repro from a real session](/recipes/generate-playwright-repro-from-real-browser-session).

## Trust & data handling

Everything here is read-tier (Level 1) and local: peek reads your own recorded session from `~/.peek`, nothing is sent to a vendor, and captured values are masked (passwords, auth headers, and detected PII are scrubbed at record time).
