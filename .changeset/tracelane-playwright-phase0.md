---
"@tracelane/playwright": patch
"@tracelane/core": patch
"@tracelane/wdio": patch
---

Fix post-navigation event loss in the Playwright adapter and harden navigation capture in the shared core.

- **@tracelane/playwright**: the fixture now re-initializes rrweb recording on every main-frame navigation (previously all events after the first `page.goto` were silently dropped). Reporter options (`mode`/`outDir`/`captureNetwork`) are now honored by the fixture via the `TRACELANE_*` env vars. Capture is best-effort — a Content-Security-Policy that blocks script evaluation degrades gracefully instead of failing the test.
- **@tracelane/core**: emit the `tracelane.nav` boundary marker on hard navigations (it was suppressed by a page-local session-id comparison); rescue pre-navigation buffered events across same-origin hard navigations via a `pagehide` → `sessionStorage` flush; lower the drain poll interval from 5000ms to 500ms.
- **@tracelane/wdio**: inherits the core navigation-marker + drain-interval improvements (no API change).

Docs corrected; tests now verify console/network/navigation data reaches the report (including a multi-page e2e that decodes the report and asserts post-navigation capture).
