---
title: "Have your agent compare the staging and prod versions of a page"
lede: "When a page renders fine on prod but broken on staging, I want my agent to diff the two real renders, not the two HTML sources."
description: "Capture the same page in two Chrome profiles (staging + prod), then ask your agent to diff the rendered DOM, network calls, and console output between them."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, diffing]
relatedRecipes: [claude-code-on-staging, validate-multi-step-authenticated-checkout, reproduce-bug-from-teammate-peek-session]
---

## What you'll end up with

A Claude Code diff between two peek sessions of "the same" page: one captured on staging, one on prod. The agent calls out DOM nodes that differ, network calls that only one environment fires, and console errors only one side produces.

![Claude Code diffing two peek sessions side by side](/recipes/assets/compare-staging-and-prod-page-versions.png)

## Prerequisites

- Claude Code with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- Two Chrome profiles, one signed in to staging and one to prod (or two separate browsers)

## Steps

### 1. Capture both renders

In the **staging** profile, open the page → peek toolbar icon → **Capture this tab**. Load the page, let it settle, stop the capture. Note the session ID peek shows.

Switch to the **prod** profile. Repeat for the same page. Note that session ID too.

### 2. Ask Claude Code to diff

> I have two peek sessions: `<staging-session-id>` (staging) and `<prod-session-id>` (prod). Diff them: tell me which DOM nodes differ, which network calls only one fired, and which console errors only appear on one side.

Claude Code calls `get_session_summary`, `get_dom_snapshot`, `get_session_network_errors`, and `get_session_console_errors` on each session, then produces a structured diff.

### 3. Triage the diff

The agent groups differences by category. Most will be noise (timestamps, request IDs); the real issue usually shows up as either a missing network call on one side or a console error unique to one environment.

## Why this works

Source diffs miss things that only show up at render time: a missing feature flag, a stale CDN bundle, an environment-specific config that changes which API a component calls. Two real captures, agent-diffed, surface those.

## Next steps

- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Validate a multi-step authenticated checkout with an AI agent watching](/recipes/validate-multi-step-authenticated-checkout)
- [Reproduce a bug from a teammate's recorded peek session](/recipes/reproduce-bug-from-teammate-peek-session)
