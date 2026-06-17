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

docs: non-badge README fixes from the public-doc audit.

Accuracy: rescope the `@tracelane/wdio` tagline to WebdriverIO only (Playwright
is the separate `@tracelane/playwright` package); replace the verbatim consumer
tagline copied onto `@tracelane/core` and `@tracelane/report` with
engine/builder-specific one-liners; drop the inapplicable "WDIO 8" CDP
instruction (peerDep is `webdriverio ^9`); de-duplicate a garbled sentence in
the `@tracelane/cli` config-edit section; fix a Cursor-docs link whose text and
href host diverged.

npm rendering: convert relative `NOTICE`/`COMPATIBILITY`/CWS links to absolute
GitHub URLs so they resolve on npmjs.com; replace placeholder Chrome-Web-Store
links with an honest "listing pending (Phase 5)" note.

Completeness: add per-package CHANGELOG links, threat-model (SECURITY-NOTES /
peek THREATMODEL) links, a `report.footer` Options row + Node ≥ 22 prose for
wdio, an Install section for `@tracelane/report`, "Related packages" cross-link
lists, a minimal API pointer for the engine packages, and a brand logo +
"What it detects" / distribution note for `@tracelane/security`.

Also tightens the `@tracelane/cli` and `@tracelane/playwright` package.json
descriptions (npm sidebar) for accuracy. Docs/metadata only; no code change.
