---
title: "Let Claude Code reproduce a bug on your authenticated staging dashboard"
lede: "When my agent can't see my staging dashboard because it's behind SSO, I want it to look at the broken page I'm already on and fix it."
description: "Give Claude Code a live, read-only view of your authenticated staging app. The agent reads the DOM, console, and network — and produces a fix."
type: hero
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, chrome]
---

## What you'll end up with

A recorded session where you report a bug verbally, Claude Code calls peek's `get_dom` / `get_console` / `get_network` tools, identifies the failed API call, and produces a one-line fix in your codebase. All on a page you're already logged into.

## Prerequisites

- A recent install of Claude Code (CLI or VS Code extension)
- The peek extension installed in Chrome
- An authenticated session on a staging environment you want to debug

## Steps

### 1. Install peek and wire it into Claude Code

```bash
npm i -g @peekdev/cli
peek init
```

`peek init` writes the MCP server entry into `~/.claude.json` for you. No manual config edit needed.

### 2. Capture your staging tab

Open your staging app in Chrome with the peek extension active. Click the peek toolbar icon and choose **Capture this tab**.

### 3. Ask Claude Code

In Claude Code, type:

> The Place Order button on this page does nothing. Look at what's happening and fix it.

Claude Code calls peek's MCP tools (`get_dom`, `get_console`, `get_network`), reads the captured state, and proposes a fix.

## Why this works

peek captures the page you're already on — including authenticated cookies, network calls, and DOM state — and exposes it over MCP. The agent reads what you read; no separate login flow.

> Trust and data handling for this recipe are summarised in the banner at the top of the page. The full policy is at [/trust-and-data](/trust-and-data) (coming soon).
