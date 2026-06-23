---
title: "Let Cursor see the real network calls your SPA is making"
lede: "When my SPA's frontend is making twelve calls and one is failing, I want Cursor to read them and tell me which header is wrong."
description: "Wire Cursor into peek's MCP server so it can read the actual network requests, headers, and responses your SPA fires — not your guess at what they look like."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [cursor, chrome]
relatedRecipes: [set-up-peek-with-cursor, claude-code-on-staging, security-review-flow-with-ai-agent]
---

## What you'll end up with

A Cursor chat where you say "one of my XHRs is failing — which one?" and the agent reads the real request URL, headers, payload, and response body from your local peek session, then points at the line in your fetch wrapper that built the bad request.

![Cursor reading peek network data and identifying a bad header](/recipes/assets/let-cursor-see-real-network-calls.png)

## Prerequisites

- Cursor with MCP support enabled
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb), or loaded unpacked from `packages/peek-extension/chrome-mv3/` for local builds
- A SPA you can reproduce the bug in

## Steps

### 1. Install peek

```bash
npm i -g @peekdev/cli
peek init
```

When the wizard asks which clients to configure, select **Cursor**. `peek init` writes the MCP server entry to `~/.cursor/mcp.json`. If you'd rather hand-write it, the canonical block is:

```json
{
  "mcpServers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp@latest"]
    }
  }
}
```

### 2. Reproduce the bug with capture on

Open the SPA in Chrome. Click the peek toolbar icon → **Capture this tab**. Click around until you see the failing call in DevTools (or just feel the page break). Stop the capture.

### 3. Ask Cursor

In Cursor's chat:

> Look at my most recent peek session. List the network calls that returned 4xx or 5xx, then explain which header is wrong on the failing one.

Cursor calls `list_recent_sessions`, then `get_session_network_errors` against that session — peek returns the failing request envelopes (URL, method, headers, response status, response body) and Cursor diffs them against the passing calls.

## Why this works

peek's network plugin attaches to the page's fetch / XHR and records request and response envelopes alongside the rrweb event stream. Cursor reads the actual call your SPA made — not a hand-redacted curl, not a screenshot of the Network panel.

## Next steps

- [Set up peek with Cursor](/recipes/set-up-peek-with-cursor)
- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
