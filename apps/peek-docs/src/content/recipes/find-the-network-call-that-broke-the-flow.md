---
title: "Find the network call that broke your flow"
lede: "When a page silently failed, I want my agent to find the request that returned an error — the method, URL, status, and what came back — without me digging through devtools."
description: "Have your AI agent surface the failed and notable network requests in a recorded peek session and pin down which call broke your flow."
type: short
status: published
publishedAt: 2026-06-29
integrations: [claude-code, cursor]
relatedRecipes: [let-cursor-see-real-network-calls, security-review-flow-with-ai-agent, generate-playwright-repro-from-real-browser-session]
---

## What you'll end up with

A list of the failed and notable network requests from a recorded session — method, URL, status, duration, and any transport error — and a clear answer to "which call broke this?"

## Prerequisites

- Claude Code or Cursor with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
- A recorded session where a page silently failed or data didn't load

See [Set up peek with Cursor](/recipes/set-up-peek-with-cursor) rather than restating the config here.

## Steps

### 1. Open the session

> Open my most recent peek session for the page that wouldn't load its data.

The agent calls `list_recent_sessions` and `get_session_summary`.

### 2. List the failed requests

> Show me the failed network requests in that session.

The agent calls `get_session_network_errors`. By default it returns 4xx/5xx responses plus any transport-level failures, oldest first — each row has the method, URL, HTTP status, status text, resource type, duration, and error text.

### 3. Correlate to what you saw

> The 500 on /api/cart — what was I doing when it fired, and what did the page show?

The agent lines that request's timestamp up against the user action and DOM at that moment (`get_user_action_before_error` for the nearest error, or `get_dom_snapshot` at the request's timestamp).

## Why this works

peek captured the real network traffic of your session locally, including failures that never surfaced in the UI. `get_session_network_errors` filters to the requests that matter — errors and notable responses — instead of the full firehose, so the breaking call is right there.

## Why responses are safe to read

Request and response bodies are masked at capture; URLs and error text are clipped. You see enough to identify the failing call without leaking secrets.

## Next steps

Reproduce the failure deterministically with [Generate a Playwright repro from a real session](/recipes/generate-playwright-repro-from-real-browser-session).

## Trust & data handling

Read-tier (Level 1): non-mutating reads of your recorded session in `~/.peek`. Local-first: peek uploads nothing — what your MCP client does with the data is up to you. Request and response bodies are masked, and URLs and error text are clipped, at record time.
