---
"@peekdev/mcp": patch
---

Document MCP-registry submission paths in the package README.

Added a maintainer-facing "Distribution" section to `packages/peek-mcp/README.md`
linking to the four pre-filled registry-submission scaffolds at
`docs/peek/distribution/`:

- the official MCP Registry (`registry.modelcontextprotocol.io`) via the
  `mcp-publisher` CLI + a `server.json`;
- PulseMCP (URL-only submission form + auto-ingest from the MCP Registry);
- Smithery (MCPB bundle upload via `smithery mcp publish`);
- mcp.so (web-form submission backed by Supabase);

…plus the standalone Claude Code skill install recipe.

The four scaffolds themselves were re-audited against each registry's
2026-05-30 schema (separate work — no code change, no `@peekdev/*` API
change). README change only; bumping `@peekdev/mcp` to keep the npm
listing's metadata aligned with the doc set being published alongside
the Phase 5 launch.
