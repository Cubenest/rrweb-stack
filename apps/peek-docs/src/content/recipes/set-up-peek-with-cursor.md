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
- Node >= 22 (peek's native `better-sqlite3` dependency only ships prebuilt binaries for Node 22+; older Node falls back to compiling from source and fails on stock Windows)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb), or loaded unpacked from `packages/peek-extension/chrome-mv3/` for local builds

## Steps

### 0. One-click (fastest) — Add to Cursor

[![Add peek to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=peek&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBwZWVrZGV2L21jcEBsYXRlc3QiXX0=)

Click the button (or paste the link into your browser). Cursor prompts to add peek to `~/.cursor/mcp.json` — no terminal, no wizard. This wires the **MCP server** so the agent can read your sessions. You still need the native messaging host (Step 2's `peek init`, run once) and the Chrome extension (Prerequisites) before there are sessions to read — so after clicking, run `peek init` once and skip to [Verify](#4-verify).

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
      "args": ["-y", "@peekdev/mcp@latest"]
    }
  }
}
```

### 4. Verify

Restart Cursor so it reloads the MCP config. In Cursor's chat:

> Call peek's `list_recent_sessions` and show me what it returns.

You should see either an empty list or your recent captures.

## Why this works

Cursor reads `~/.cursor/mcp.json` on startup, spawns the listed MCP servers as subprocesses, and exposes their tools to the agent. `npx -y @peekdev/mcp@latest` runs peek's MCP server on demand and talks to the local SQLite store the Chrome extension writes to. (The `@latest` tag is required while peek is in alpha — a bare `@peekdev/mcp` resolves an implicit `*` range that doesn't match prerelease versions and fails with `ETARGET`.)

## Next steps

- [Let Cursor see the real network calls your SPA is making](/recipes/let-cursor-see-real-network-calls)
- [Set up peek with Claude Code in 2 minutes](/recipes/set-up-peek-with-claude-code)
- [Set up peek with Cline, Windsurf, or Codex CLI](/recipes/set-up-peek-with-cline-windsurf-codex)
