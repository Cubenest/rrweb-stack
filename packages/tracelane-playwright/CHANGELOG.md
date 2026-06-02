# @tracelane/playwright

## 0.1.0-alpha.1

### Minor Changes

- 14aea8d: New package: `@tracelane/playwright` — a Playwright Reporter + auto-fixture that records the rrweb session, console, and failed-network requests for every test and writes a self-contained, offline HTML report on failure (P1 PRD §B). No SaaS, no signup, no cloud.

  Wire it in two lines: register the reporter in `playwright.config.ts` and replace `@playwright/test`'s `test`/`expect` import with `@tracelane/playwright/fixture`. The auto-fixture owns the recorder lifecycle (it is the only place with a live `page`/`testInfo`); the reporter handles config + an end-of-run summary. rrweb is injected via `context.addInitScript`, events are drained Node-side via `@tracelane/core`'s recorder, and failed-network capture uses CDP on Chromium (degrading to rrweb+console on Firefox/WebKit). Reuses `@tracelane/core` and `@tracelane/report`. MVP parity with `@tracelane/wdio`.

### Patch Changes

- Updated dependencies [14aea8d]
  - @tracelane/core@0.1.0-alpha.11
  - @tracelane/report@0.1.0-alpha.13
