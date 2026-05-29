---
"@peekdev/mcp": patch
"@peekdev/cli": patch
"@peekdev/extension": patch
---

Phase 4c alpha.7 cleanups — close the 3 remaining annoyances from the
manual QA walk (docs/qa/findings-2026-05-28.md):

- J.6 (peek-extension + peek-mcp): rrweb recorder now emits a fresh
  FullSnapshot every 2 minutes (checkoutEveryNms: 120_000) and every
  5000 events. Bounds the look-back window for get_dom_snapshot so AI
  tools get a reconstructed DOM at the error timestamp even when the
  error fires deep into a long-running session.
- K.2 (peek-cli + peek-mcp): `peek sessions export --format playwright`
  now wires through to the same `generatePlaywrightRepro` code path that
  the MCP `generate_playwright_repro` tool uses. CLI + AI consumers get
  identical output for the same session. peek-mcp gains
  `./mcp/playwright-repro` and `./mcp/event-blobs` subpath exports.
- P-18 (peek-cli): `peek sessions list --json` outputs machine-readable
  JSON; `peek sessions list --help` prints usage and exits 0. parseArgs
  no longer crashes on unknown flags. Same `--help` treatment extended
  to show / export / delete / audit subcommands; each has a
  subcommand-specific usage block.

peek-extension stays private (no npm publish); peek-cli and peek-mcp
republish via OIDC.
