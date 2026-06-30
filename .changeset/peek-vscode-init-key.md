---
"@peekdev/cli": patch
---

peek init: write the correct MCP config key for VS Code

`peek init` now writes the `servers` root key to `.vscode/mcp.json` for VS Code
(VS Code reads MCP servers from `servers`, with `type` inferred as stdio),
instead of `mcpServers` — the previous output was silently ignored by VS Code.
Other clients are unchanged (they use `mcpServers`).
