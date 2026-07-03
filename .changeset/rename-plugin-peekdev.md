---
"@peekdev/mcp": patch
---

Rename the Claude Code plugin `peek` → `peekdev` (community-catalog
de-confliction).

The bare plugin name `peek` is already held in Anthropic's `claude-community`
marketplace by an unrelated project (gopeek.ai), and catalog entry names are
globally unique — so our plugin can only be listed under a distinct name. The
plugin is renamed in `plugins/peek/.claude-plugin/plugin.json` and the repo
marketplace entry, and this package's README "Install as a Claude Code plugin"
command is updated to `/plugin install peekdev@peek` to match. The MCP server
name (`peek`) and the tool namespace (`mcp__peek__*`) are unchanged; only the
plugin's install/skill identity moves to `peekdev`.
