---
"@peekdev/mcp": patch
---

Add `mcpName` (`io.github.cubenest/peek-mcp`) to package.json and a `server.json`, enabling publication to the official MCP Registry.

The registry verifies npm package ownership by reading the `mcpName` field from the **published** package at the exact version referenced in `server.json` — so this field must ship in the package (this release) before the server can be listed via `mcp-publisher publish`.
