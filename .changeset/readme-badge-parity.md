---
"@tracelane/wdio": patch
"@tracelane/playwright": patch
"@tracelane/cli": patch
"@tracelane/core": patch
"@tracelane/report": patch
"@peekdev/cli": patch
"@peekdev/mcp": patch
"@cubenest/rrweb-core": patch
---

docs: normalize README badge rows across all published packages.

Two published packages (`@tracelane/core`, `@tracelane/report`) and the shared
`@cubenest/rrweb-core` had no badges at all; OpenSSF Scorecard was applied
unevenly (missing from playwright, peek-cli, peek-mcp); and no package carried
the accurate `types` / `node` engine badges despite all shipping `.d.ts` and
declaring `engines.node >=22`.

Every README now leads with a consistent, verified badge row — version,
downloads, license, CI, OpenSSF Scorecard, then `types` (libraries only — not
the bin-only CLIs), `node`, and a static `alpha` status badge. All badge
endpoints were verified to resolve against the published `latest` dist-tag.
Docs-only; no code change.
