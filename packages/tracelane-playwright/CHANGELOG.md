# @tracelane/playwright

## 0.1.0-alpha.2

### Patch Changes

- e250248: Fix post-navigation event loss in the Playwright adapter and harden navigation capture in the shared core.
  - **@tracelane/playwright**: the fixture now re-initializes rrweb recording on every main-frame navigation (previously all events after the first `page.goto` were silently dropped). Reporter options (`mode`/`outDir`/`captureNetwork`) are now honored by the fixture via the `TRACELANE_*` env vars. Capture is best-effort — a Content-Security-Policy that blocks script evaluation degrades gracefully instead of failing the test.
  - **@tracelane/core**: emit the `tracelane.nav` boundary marker on hard navigations (it was suppressed by a page-local session-id comparison); rescue pre-navigation buffered events across same-origin hard navigations via a `pagehide` → `sessionStorage` flush; lower the drain poll interval from 5000ms to 500ms.
  - **@tracelane/wdio**: inherits the core navigation-marker + drain-interval improvements (no API change).

  Docs corrected; tests now verify console/network/navigation data reaches the report (including a multi-page e2e that decodes the report and asserts post-navigation capture).

- Updated dependencies [e250248]
  - @tracelane/core@0.1.0-alpha.12
  - @tracelane/report@0.1.0-alpha.14

## 0.1.0-alpha.1

### Minor Changes

- 14aea8d: New package: `@tracelane/playwright` — a Playwright Reporter + auto-fixture that records the rrweb session, console, and failed-network requests for every test and writes a self-contained, offline HTML report on failure (P1 PRD §B). No SaaS, no signup, no cloud.

  Wire it in two lines: register the reporter in `playwright.config.ts` and replace `@playwright/test`'s `test`/`expect` import with `@tracelane/playwright/fixture`. The auto-fixture owns the recorder lifecycle (it is the only place with a live `page`/`testInfo`); the reporter handles config + an end-of-run summary. rrweb is injected via `context.addInitScript`, events are drained Node-side via `@tracelane/core`'s recorder, and failed-network capture uses CDP on Chromium (degrading to rrweb+console on Firefox/WebKit). Reuses `@tracelane/core` and `@tracelane/report`. MVP parity with `@tracelane/wdio`.

### Patch Changes

- Updated dependencies [14aea8d]
  - @tracelane/core@0.1.0-alpha.11
  - @tracelane/report@0.1.0-alpha.13
