---
"@cubenest/rrweb-core": patch
"@tracelane/core": patch
"@tracelane/cli": patch
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Launch-readiness metadata + documentation accuracy fixes:

- Add `bugs` and `engines.node` (`>=20.18.0`) to every published package.
- Strip internal ticket references (ADR-NNNN) from user-facing strings (npm
  `description` fields and a CLI error message).
- `@peekdev/mcp` README: replace the tool table with the real 10-tool surface
  and correct the permission model to the canonical 0–4 levels
  (Off / Read-only / Suggest-only / Act-with-confirm / YOLO) with the
  destructive-action blocklist as a cross-level override.
- `@peekdev/cli` README: the MCP server exposes 10 tools (not "~20").
- `@tracelane/cli`: repoint the dead Playwright/Cypress "coming soon" links to
  the live issues board, and qualify the hero tagline (WebdriverIO today;
  Playwright + Cypress on the roadmap).
