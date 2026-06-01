---
title: "Let Claude Code reproduce a bug on your authenticated staging dashboard"
lede: "When my agent can't see my staging dashboard because it's behind SSO, I want it to look at the broken page I'm already on and fix it."
description: "Give Claude Code a live, read-only view of your authenticated staging app. The agent reads the DOM, console, and network — and produces a fix."
type: hero
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, chrome, mcp]
---

## What you'll end up with

A recorded session where you report a bug verbally, Claude Code calls peek's `get_dom` / `get_console` / `get_network` tools, identifies the failed API call, and produces a one-line fix in your codebase. All on a page you're already logged into.

## Prerequisites

- A recent install of Claude Code (CLI or VS Code extension)
- The peek extension installed in Chrome
- An authenticated session on a staging environment you want to debug

## Steps

### 1. Install peek

```bash
npm i -g @peekdev/cli
peek init
```

### 2. Configure Claude Code

Add the peek MCP server to your `~/.claude/mcp_servers.json`:

```json
{
  "peek": {
    "command": "peekdev",
    "args": ["mcp"]
  }
}
```

### 3. Open your staging app in Chrome with the peek extension active.

Click the peek toolbar icon and choose "Capture this tab".

### 4. Ask Claude Code

In Claude Code, type: "The Place Order button on this page does nothing. Look at what's happening and fix it."

Claude Code calls peek's MCP tools, reads the captured state, and proposes a fix.

## Why this works

peek captures the page you're already on — including authenticated cookies, network calls, DOM state — and exposes it over MCP. The agent reads what you read; no separate login flow.

## Trust & data handling

- peek captures: DOM snapshots, console messages, network metadata of the active tab.
- peek does NOT capture: login credentials, password fields (redacted by default), or any tab you haven't explicitly opted in.
- Per-action authorization: peek requires a click-confirmation before performing any `execute_action` write.
- Data stays on your machine. The only thing the AI client sees is what you send over MCP.
