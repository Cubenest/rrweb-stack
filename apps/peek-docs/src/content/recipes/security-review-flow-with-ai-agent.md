---
title: "Security-review a flow by letting your agent inspect the live DOM"
lede: "When I'm reviewing a sign-up flow for tokens-in-URL or leaked secrets, I want my agent to look at the actual rendered DOM and network traffic — not the source."
description: "Hand your AI agent a recorded peek session and have it surface tokens-in-URLs, leaked secrets, mixed content, and risky third-party calls in the flow."
type: short
status: published
publishedAt: 2026-06-15
integrations: [claude-code, security]
relatedRecipes: [use-peek-with-per-action-approval, claude-code-on-staging, validate-multi-step-authenticated-checkout]
---

## What you'll end up with

A Claude Code report listing concrete findings against a flow you just walked through — e.g. "the password reset token appears in the Referer header of the analytics call to vendor.example.com" — sourced from the real rendered DOM and network log, not the source code.

![Claude Code reviewing a peek session for security issues](/recipes/assets/security-review-flow-with-ai-agent.png)

## Prerequisites

- Claude Code with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- A flow worth reviewing (sign-up, password reset, payment, OAuth callback)

## Steps

### 1. Walk the flow with capture on

Open Chrome on the page where the flow starts. Click the peek toolbar icon → **Capture this tab**. Walk the flow once, end-to-end. Stop the capture.

### 2. Ask Claude Code to review

> Review my most recent peek session for security issues. Look for tokens in URLs, secrets in request/response bodies, mixed content, third-party calls that received sensitive data, and any DOM elements that render unsanitized input.

Claude Code will call `get_session_summary`, then `get_session_network_errors`, `get_dom_snapshot`, and `query_dom_history` to inspect the rendered output and network traffic at each step.

### 3. Triage the findings

The agent returns a short list with severity. Each finding cites the session timestamp and the URL or DOM node, so you can jump straight to the offending code path.

## Why this works

peek captures the rendered DOM (after JS runs) and the full request/response envelopes. Source review can miss tokens that get appended by a third-party script or query params added by a redirect; a session review can't.

## Notes on data handling

The session you capture includes whatever was on the page — including, by design, tokens and secrets you want the review to surface. This data stays in your local SQLite store under `~/.peek/` and never leaves your machine. The TrustBanner at the top of this page is the short version; if you're sharing the session with a teammate, see [Reproduce a bug from a teammate's recorded peek session](/recipes/reproduce-bug-from-teammate-peek-session) for export hygiene.

## Next steps

- [Use peek with per-action approval for sensitive flows](/recipes/use-peek-with-per-action-approval)
- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Validate a multi-step authenticated checkout with an AI agent watching](/recipes/validate-multi-step-authenticated-checkout)
