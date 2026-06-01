---
title: "Set up peek with Claude Code in 2 minutes"
lede: "When I want to try peek with my Claude Code install, I want one command that wires up the MCP server without me touching JSON files."
description: "Install the peek CLI, run peek init, and Claude Code starts seeing your captured browser sessions. No manual JSON editing of ~/.claude.json."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, install]
relatedRecipes: [claude-code-on-staging, set-up-peek-with-cursor, set-up-peek-with-cline-windsurf-codex]
---

## What you'll end up with

A working peek MCP server registered with Claude Code, verified by asking Claude to call `list_recent_sessions` and seeing it respond.

![Claude Code listing peek sessions after install](/recipes/assets/set-up-peek-with-claude-code.png)

## Prerequisites

- A recent install of Claude Code (CLI or VS Code extension)
- Node >= 20
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)

## Steps

### 1. Install the CLI

```bash
npm i -g @peekdev/cli
```

The package name is `@peekdev/cli`; the binary it installs is `peek`.

### 2. Run `peek init`

```bash
peek init
```

The wizard detects Claude Code's `~/.claude.json` and offers to write the MCP server entry. Accept it. The block it adds is:

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

If Claude Code was running, restart it so it picks up the new server.

### 3. Verify

In Claude Code:

> Call peek's `list_recent_sessions` tool and show me what you get.

You should see either an empty list (no sessions captured yet) or your most recent capture sessions.

## Why this works

`peek init` reads the existing `~/.claude.json`, merges in the `mcpServers.peek` entry without touching any other servers, and writes the file back. Claude Code starts the server on demand via `npx -y @peekdev/mcp`, so there's no daemon to manage.

## Next steps

- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Set up peek with Cursor](/recipes/set-up-peek-with-cursor)
- [Set up peek with Cline, Windsurf, or Codex CLI](/recipes/set-up-peek-with-cline-windsurf-codex)
