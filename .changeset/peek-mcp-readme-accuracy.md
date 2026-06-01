---
"@peekdev/mcp": patch
---

Docs-only: 4 README accuracy fixes against source of truth.

- Acknowledge that the cross-process IPC bridge for `execute_action` /
  `request_authorization` (the `LocalSocketHostBridge`) is in development;
  alpha.11 returns `bridge not wired in this MCP process` on those calls,
  so peek is effectively read-only today. Same honest framing as the
  per-action-approval recipe.
- Correct Claude Code config path (`~/.claude.json`, not
  `~/.claude/mcp_servers.json`); add a canonical-paths table sourced from
  `packages/peek-cli/src/lib/init-config.ts` so the README stays in sync
  with the wizard.
- Replace the nonexistent `startNativeHost` subpath-export example with
  `buildManifest` + `installManifests` (which are the actual exports).
- Drop the `PEEK_HOME=~/.peek` example value (it's the default, so setting
  it was a no-op) and replace with a one-line note explaining when to
  override.

No API changes; bump exists solely to push the corrected README to npm.
