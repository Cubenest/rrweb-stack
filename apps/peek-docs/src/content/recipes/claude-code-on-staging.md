---
title: "Let Claude Code reproduce a bug on your authenticated staging dashboard"
lede: "When my agent can't see my staging dashboard because it's behind SSO, I want it to look at the broken page I'm already on and fix it."
description: "Give Claude Code a live, read-only view of your authenticated staging app over MCP. Your agent reads the DOM, console, and network — and proposes a fix."
type: hero
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, chrome]
relatedRecipes: [set-up-peek-with-claude-code, generate-playwright-repro-from-real-browser-session, let-cursor-see-real-network-calls]
---

## What you'll end up with

A Claude Code conversation where you describe a bug ("the Place Order button does nothing") and the agent inspects the page you're already on — same SSO session, same cookies, same in-flight network calls — to find the broken call and propose a fix in your codebase.

![Claude Code reading a peek session and proposing a fix](/recipes/assets/claude-code-on-staging.png)

## Prerequisites

- A recent install of Claude Code (CLI or VS Code extension)
- Chrome with the peek extension loaded (currently via `chrome://extensions` → **Load unpacked** at `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- An authenticated session on a staging environment you want to debug

## Steps

### 1. Install peek and wire it into Claude Code

```bash
npm i -g @peekdev/cli
peek init
```

`peek init` writes the MCP server entry into `~/.claude.json` for you. The block it adds is exactly:

```json
{
  "peek": {
    "command": "npx",
    "args": ["-y", "@peekdev/mcp"]
  }
}
```

No manual config edit needed for Claude Code.

### 2. Capture the broken page

Open your staging app in Chrome with the peek extension active. Reproduce the bug once. Click the peek toolbar icon and choose **Capture this tab** — the session is written to peek's local SQLite store under `~/.peek/`.

### 3. Ask Claude Code

In Claude Code, point at the captured session:

> The Place Order button on this page does nothing. Use peek to look at what's happening and find the broken call.

Claude Code calls peek's MCP tools — `list_recent_sessions`, `get_session_summary`, `get_session_console_errors`, `get_session_network_errors`, `get_user_action_before_error` — reads the captured state, and proposes a fix.

## Why this works

peek records the page you're already on — authenticated cookies, network responses, DOM mutations, console errors — into a local SQLite store and exposes it to your agent over MCP. Your agent reads what you read. No separate login flow, no copying URLs around, no cloud round-trip.

## Next steps

- [Set up peek with Claude Code in 2 minutes](/recipes/set-up-peek-with-claude-code)
- [Generate a Playwright repro from a real browser session](/recipes/generate-playwright-repro-from-real-browser-session)
- [Let Cursor see the real network calls your SPA is making](/recipes/let-cursor-see-real-network-calls)
