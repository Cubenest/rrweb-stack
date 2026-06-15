---
"@tracelane/cli": minor
---

`tracelane init` now scaffolds Playwright projects (previously a stale "support coming Q3/Q4 2026" no-op).

When a `playwright.config.{ts,js,mjs,cjs}` is detected (or `--runner playwright` is passed), init now:

- installs `@tracelane/playwright` as a dev dependency via the detected package manager;
- registers the `['@tracelane/playwright', { mode: 'failed' }]` entry in the config's `reporter` array — creating the array if absent, appending if present, idempotent on re-run, and backing out cleanly (never corrupting the file) if it can't recognise the shape;
- creates `./tracelane-reports/` and adds it to `.gitignore`;
- prints a clear, copy-pasteable follow-up reminding the user to swap their spec imports to `import { test, expect } from '@tracelane/playwright/fixture'` (the recording is fixture-driven and the CLI can't safely rewrite every spec file).

WebdriverIO scaffolding is unchanged. Cypress is still detected but reported as not-yet-supported (the `@tracelane/cypress` adapter is unpublished); the stale 2026 ship-date messaging has been removed.
