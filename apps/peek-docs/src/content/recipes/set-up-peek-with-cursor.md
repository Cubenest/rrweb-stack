---
title: "Set up peek with Cursor"
lede: "When I'm a Cursor user, I want peek wired into my MCP config so the agent can read my browser sessions."
description: "Run peek init and let it write the peek MCP server into your Cursor mcp.json — or paste the canonical JSON block if you'd rather not run the wizard."
type: short
status: published
publishedAt: 2026-06-15
integrations: [cursor, install]
relatedRecipes: [let-cursor-see-real-network-calls, set-up-peek-with-claude-code, set-up-peek-with-cline-windsurf-codex]
---

## What you'll end up with

A working peek MCP server registered with Cursor at `~/.cursor/mcp.json`, verified by asking Cursor to call `list_recent_sessions` and seeing it respond.

![Cursor listing peek sessions after install](/recipes/assets/set-up-peek-with-cursor.png)

## Prerequisites

- Cursor with MCP enabled
- Node >= 20
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)

## Steps

### 1. Install the CLI

```bash
npm i -g @peekdev/cli
```

### 2. Run `peek init` and select Cursor

```bash
peek init
```

The wizard detects supported clients on your machine — Claude Code, Cursor, VS Code, Windsurf, and Cline. Select **Cursor**. peek writes the MCP entry into `~/.cursor/mcp.json`, merging with any existing servers.

### 3. (Manual fallback) Edit `~/.cursor/mcp.json` directly

If the wizard can't reach your config or you'd rather hand-edit, paste this block:

```json
{
  "mcpServers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp"]
    }
  }
}
```

### 4. Verify

Restart Cursor so it reloads the MCP config. In Cursor's chat:

> Call peek's `list_recent_sessions` and show me what it returns.

You should see either an empty list or your recent captures.

## Why this works

Cursor reads `~/.cursor/mcp.json` on startup, spawns the listed MCP servers as subprocesses, and exposes their tools to the agent. `npx -y @peekdev/mcp` runs peek's MCP server on demand and talks to the local SQLite store the Chrome extension writes to.

## Next steps

- [Let Cursor see the real network calls your SPA is making](/recipes/let-cursor-see-real-network-calls)
- [Set up peek with Claude Code in 2 minutes](/recipes/set-up-peek-with-claude-code)
- [Set up peek with Cline, Windsurf, or Codex CLI](/recipes/set-up-peek-with-cline-windsurf-codex)
