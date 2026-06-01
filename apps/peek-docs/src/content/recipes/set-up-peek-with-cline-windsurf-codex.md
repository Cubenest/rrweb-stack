---
title: "Set up peek with Cline, Windsurf, or Codex CLI"
lede: "When I use Cline, Windsurf, or Codex CLI, I want peek's MCP server registered without hunting for each tool's config file."
description: "Per-client MCP wiring for Cline, Windsurf, and Codex CLI — what peek init handles automatically and the manual JSON block when it can't."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [cline, windsurf, codex-cli, install]
relatedRecipes: [set-up-peek-with-claude-code, set-up-peek-with-cursor, claude-code-on-staging]
---

## What you'll end up with

A working peek MCP server registered with whichever of Cline, Windsurf, or Codex CLI you use, verified by asking the agent to call `list_recent_sessions`.

![peek wired into multiple MCP clients](/recipes/assets/set-up-peek-with-cline-windsurf-codex.png)

## Prerequisites

- One or more of: Cline, Windsurf, Codex CLI
- Node >= 20
- `npm i -g @peekdev/cli`
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)

## Steps

Run `peek init` first — for Windsurf the wizard writes the config for you. For Cline and Codex CLI the config has to be added by hand; the wizard prints the canonical block to paste.

### Cline

Cline stores its MCP config inside the VS Code extension's per-OS `globalStorage` directory, so peek's wizard surfaces it as **manual config required** rather than guessing the path. Open the Cline panel in VS Code → **MCP Servers** → **Configure MCP Servers**, and add:

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

Reload the VS Code window to pick up the new server.

### Windsurf

```bash
peek init
```

Select **Windsurf** in the wizard. It writes the entry into `~/.codeium/windsurf/mcp_config.json`. Restart Windsurf to pick up the new server. If you prefer hand-editing, the block is the same `mcpServers.peek` JSON shown above.

### Codex CLI

Codex CLI reads MCP config from `~/.codex/config.toml` (TOML, not JSON). `peek init` doesn't write this file today; paste the following manually:

```toml
[mcp_servers.peek]
command = "npx"
args = ["-y", "@peekdev/mcp"]
```

Then restart Codex CLI.

### Verify

In any of the three clients:

> Call peek's `list_recent_sessions` and show me what it returns.

You should see either an empty list or your captured sessions.

## Why this works

All three clients implement the MCP client protocol — they spawn the configured server as a subprocess and call its tools. The only thing that varies is the config file location and format. peek's CLI knows the JSON-format ones it can write; the TOML one (Codex CLI) and the per-OS-globalStorage one (Cline) get a manual block.

## Next steps

- [Set up peek with Claude Code in 2 minutes](/recipes/set-up-peek-with-claude-code)
- [Set up peek with Cursor](/recipes/set-up-peek-with-cursor)
- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
