---
"@tracelane/wdio": patch
"@tracelane/core": patch
"@tracelane/report": patch
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Phase 5 launch-readiness: README hero rewrite for the npm landing pages.

- `@peekdev/cli` + `@peekdev/mcp`: shipping a README for the first time.
  The alpha.x publishes to date had no README at all — npm rendered
  "no readme found" on the package pages. Both now lead with the locked
  peek tagline, install command above the fold, anti-positioning
  (not Sentry / not LogRocket / not a remote MCP), CLI subcommand
  reference + manual MCP-client config snippets.
- `@tracelane/wdio`: full hero rewrite. Tagline + badges + 5-line
  install moved above the fold. "What this is NOT" section added.
  Existing technical content (full example, options table, hook-factory,
  network capture, FAQ) preserved below.
- `@tracelane/core` + `@tracelane/report`: light touch — tagline
  header + stronger redirect to @tracelane/wdio for npm-search landers.

Per the Phase 5 launch plan (docs/PHASE_5_LAUNCH_PLAN.md):
- Gate B2 (first-paragraph, no marketing voice) → GREEN both products
- Gate B3 (install command above the fold) → GREEN both products
- Gate B1 (hero GIF) — vhs scaffold at assets/tracelane-hero.tape;
  recording pending. peek GIF lands Week 3-4.
