---
'@tracelane/cli': minor
---

Adds a new `tracelane index <dir>` subcommand that scans a directory of tracelane HTML reports and emits a single self-contained `index.html` triage page. Each card surfaces the test title, spec, status, error excerpt, duration, browser, viewport, and capture timestamp — failed tests sort to the top by default. Click any card to open its full replay. Use this for the "200+ failures in one CI run" scenario: scan the grid, identify the three real bugs amid the cascade of downstream side-effects, ignore the rest. Options: `--out <path>` (default `<dir>/index.html`), `--sort captured|spec|status`, `--title <text>`.
