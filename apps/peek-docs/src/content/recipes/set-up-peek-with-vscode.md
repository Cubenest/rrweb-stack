---
title: "Set up peek with VS Code (Copilot) in 2 minutes"
lede: "When I want peek's captured sessions in VS Code's Copilot agent, I want the one MCP entry that actually works — not a config VS Code silently ignores."
description: "Wire the peek MCP server into VS Code Copilot via .vscode/mcp.json (the servers key, not mcpServers), then verify Copilot can call list_recent_sessions."
type: short
status: published
publishedAt: 2026-06-30
integrations: [vscode, install]
relatedRecipes: [set-up-peek-with-claude-code, set-up-peek-with-cursor, using-peek-with-your-agent]
---

## What you'll end up with

peek's MCP server registered with VS Code's Copilot agent, verified by asking Copilot to call `list_recent_sessions` and seeing your recorded sessions.

## Prerequisites

- VS Code with GitHub Copilot (agent mode / MCP support).
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb).
- At least one recorded session (browse with the extension on).

## Steps

### 1. Add the MCP server to your workspace

Create `.vscode/mcp.json` in your project. VS Code uses the **`servers`** key — note this differs from the `mcpServers` key other clients use:

```json
{
  "servers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp@latest"]
    }
  }
}
```

Or run `peek init` and choose **VS Code** — it writes the same `.vscode/mcp.json` for you.

### 2. Start the server and verify

Open the Copilot agent view, confirm **peek** is listed under MCP servers (start it if prompted), then ask:

> List my recent peek sessions.

Copilot calls `list_recent_sessions` and shows your captured sessions.

## Why this works

VS Code reads workspace MCP servers from `.vscode/mcp.json` under the `servers` key; `type` defaults to stdio when you provide `command`/`args`, so peek's `npx -y @peekdev/mcp@latest` launches as a local stdio server.

## Next steps

New to peek's tools? See [Using peek with your AI coding agent](/recipes/using-peek-with-your-agent).

## Trust & data handling

Read-tier by default: peek inspects sessions recorded locally in `~/.peek`, non-mutating. Local-first: peek uploads nothing — what your MCP client does with the data is up to you. Captured values are masked at record time.
