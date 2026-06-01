---
title: "Reproduce a bug from a teammate's recorded peek session"
lede: "When a teammate hits a bug I can't reproduce, I want to replay the session they recorded — without spinning up their environment."
description: "Export a peek session from one machine, drop it onto another, and let your agent investigate the original capture instead of guessing at the repro steps."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, sharing]
relatedRecipes: [generate-playwright-repro-from-real-browser-session, claude-code-on-staging, use-peek-with-per-action-approval]
---

## What you'll end up with

A peek session captured on your teammate's machine — DOM, console, network — replayed against your local agent. The agent calls peek's read tools as if you'd recorded it, and you investigate without ever reproducing the steps.

![Importing a teammate's peek session](/recipes/assets/reproduce-bug-from-teammate-peek-session.png)

## Prerequisites

- Claude Code with peek wired in on both your machine and your teammate's
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- A way to transfer a file between the two machines (Slack DM, Drive, signed email — your call)

## Steps

### 1. (Teammate) Capture the bug

In Chrome, peek toolbar icon → **Capture this tab**. Reproduce the bug. Stop the capture. peek writes the session into the local SQLite store under `~/.peek/`.

### 2. (Teammate) Export the session

Find the session row in `~/.peek/peek.db` (each session is one row plus its events). The simplest export is the whole `.peek/` directory — zip it and send it to you. Keep in mind this contains masked DOM, network envelopes, and console output for the captured tab.

### 3. (You) Import the session

Drop the received `peek.db` into a sandbox path you can point peek's MCP server at. For a quick swap, back up your own `~/.peek/peek.db` and copy theirs in. (A dedicated `peek import` command is on the roadmap — track [peek-cli #issues](https://github.com/Cubenest/rrweb-stack/issues).)

### 4. Ask Claude Code to investigate

> The session in my peek store is from a teammate, not me. List the sessions, summarise the most recent one, and walk me through what they did before the error.

Claude Code calls `list_recent_sessions`, `get_session_summary`, and `get_user_action_before_error` against the imported session.

## Notes on data handling

Captured sessions can contain authenticated state — cookies, JWTs, user PII, internal hostnames. Treat a peek export the way you'd treat a HAR file from prod traffic: share over channels approved for that data class, and delete after the bug is fixed. The TrustBanner at the top of this page covers the local-only default; sharing breaks that default by design.

## Why this works

peek's storage is a plain SQLite file. Anything that can be copied between machines can be replayed on another. The agent doesn't care which Chrome captured the events — it reads them through the same MCP tools either way.

## Next steps

- [Generate a Playwright repro from a real browser session](/recipes/generate-playwright-repro-from-real-browser-session)
- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Use peek with per-action approval for sensitive flows](/recipes/use-peek-with-per-action-approval)
