---
"@peekdev/cli": patch
---

Ship Claude Code Skill for peek.

`peek init` now drops a SKILL.md into `~/.claude/skills/peek/SKILL.md` when
Claude Code is among the configured clients or `~/.claude.json` already
exists. The skill teaches Claude Code *when* to reach for peek's MCP tools
(investigating an error from a manual repro, generating a Playwright test
from a session, querying DOM state at a past moment, "what was the user
doing before X failed", etc.) — complementary to the `mcpServers.peek`
block that exposes the tools themselves.

The skill documents the 10 MCP tools (`list_recent_sessions`,
`get_session_summary`, `get_session_console_errors`,
`get_session_network_errors`, `get_user_action_before_error`,
`get_dom_snapshot`, `query_dom_history`, `generate_playwright_repro`,
`request_authorization`, `execute_action`), the standard workflow shape
(start with `list_recent_sessions`, drill in by `sessionId`), the
five-level per-origin permission model + the destructive-action consent
flow, and three worked examples (500-error investigation, Playwright test
generation, live-browser action with consent).

Implementation:

- `packages/peek-cli/skills/peek-skill.md` — the canonical skill content
  (~6 KB). `scripts/postbuild.mjs` copies it into `dist/skills/` so the
  installed npm tarball can read it relative to the running JS.
- `packages/peek-cli/src/lib/claude-skill.ts` — pure `installSkill()`
  function with injected IO (`fileExists` / `readFile` / `writeFile` /
  `mkdir`) so the behavior is testable without touching the real
  filesystem. Returns one of five outcomes: `wrote` / `updated` /
  `unchanged` (idempotent — re-running over a byte-identical file is a
  no-op) / `source_missing` / `error`.
- `packages/peek-cli/src/commands/init.ts` — wires the skill install
  between `configureClients` and `registerNativeHost`. Only fires when
  Claude Code is in the chosen client set OR `~/.claude.json` already
  exists (don't write a skill for a tool the user doesn't have). New
  `--skip-skill` flag.
- `packages/peek-cli/test/claude-skill.test.ts` — 8 unit tests covering
  the five outcomes, fresh install, idempotent re-run, stale-content
  refresh, source-missing, write-failure, and unreadable-but-overwritable
  existing file.
- `packages/peek-cli/README.md` — new "Claude Code skill" subsection.
- `docs/peek/distribution/claude-code-skill.md` — standalone curl-able
  recipe for users who want the skill without running `peek init`.

`pnpm --filter @peekdev/cli test`: 141 tests pass (was 133; +8 new).

Per launch plan §3.2, this is the Week 2 peek ship.
