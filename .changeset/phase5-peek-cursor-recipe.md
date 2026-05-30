---
"@peekdev/cli": patch
---

Document the project-level Cursor `.cursor/mcp.json` recipe.

`peek init` writes Cursor's MCP server block to the global config at
`~/.cursor/mcp.json`. Some users prefer to scope peek per-project — a
project-level `.cursor/mcp.json` at the workspace root is the supported
alternative. New README subsection under "Supported AI clients" walks
through the trade-off (global vs project), shows the exact JSON, and
points to `peek init --skip-clients` as the way to install the native
messaging host without writing any MCP config.

The recipe is documentation only — no code changes to `@peekdev/cli`.
The block shown in the README is byte-identical to `PEEK_MCP_BLOCK` in
`src/lib/init-config.ts`, so the two configs remain interchangeable.

Companion artifact at `docs/peek/distribution/cursor-directory-submission.md`
documents the (maintainer-side) cursor.directory submission flow: the
2026 migration from `pontusab/cursor.directory` to
`cursor/community-plugins` switched the contract from "open a PR" to
"submit the repo URL via the web form and let the auto-detector find
`.mcp.json` at repo root." The doc captures the exact `.mcp.json` shape
to ship on `Cubenest/rrweb-stack` and the per-launch checklist before
the maintainer triggers the submission.

Per launch plan §3.2, this is the Week 2-3 peek/Cursor ship.
