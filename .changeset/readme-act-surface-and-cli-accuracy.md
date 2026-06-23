---
"@peekdev/cli": patch
"@tracelane/wdio": patch
"@tracelane/cli": patch
"@tracelane/core": patch
"@tracelane/report": patch
---

docs: README accuracy pass — peek act surface, CLI commands, and adapter options.

peek is no longer read-only in the docs: `@peekdev/cli` now states peek reads
recorded sessions **and**, with explicit per-origin consent, drives the live
page; the MCP tool count is corrected to 16 (adds the live ref-tagged page view
alongside the act/handoff tools); and the `Commands` block is rewritten to match
the actual CLI — `peek audit log` (with `--since/--tool/--client/--json`),
`peek sessions list/export/delete` flags, the `markdown` export default, and a
note that `--format html` is reserved/unimplemented.

Adapter/engine accuracy: `@tracelane/wdio` documents the real default-on
`security` option and the `consolePluginOptions` pass-through; `@tracelane/cli`
documents the shipped `tracelane index` subcommand; `@tracelane/core` drops the
invented "Q4 2026" Cypress ship date (Cypress is "on the roadmap"); and
`@tracelane/report` documents the advisory security panel and `buildReport`'s
optional `options` argument. Docs-only; no code change.
