# @tracelane/playwright

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies [37053af]
  - @tracelane/report@0.1.0-alpha.18

## 0.1.0-alpha.5

### Patch Changes

- b688e07: Fix: deliver `[tracelane.sec]` main-document response metadata via a Node-side
  rrweb Custom event instead of a page `console.error`.

  The advisory security layer surfaced main-document response metadata (security-
  header presence + cookie flags) by having `attachNetworkCapture` call a page
  `console.error('[tracelane.sec] ' + json)`. The main-document response fires at
  navigation time, and that page `console.error` raced rrweb's per-navigation
  re-injection — it landed outside the console plugin's recording window and was
  lost. As a result the `missing-security-header`, `insecure-cookie`, and
  `mixed-content` findings never fired end-to-end (only the pure-DOM
  `reverse-tabnabbing` worked).

  The capture layer now delivers the meta Node-side through a new
  `onSecurityMeta` callback on `attachNetworkCapture`; the adapters wire it to
  `recorder.addCustomEvent('tracelane.sec', meta)`, appending the meta directly to
  the recorder's Node buffer as an rrweb Custom event (immune to navigation
  timing). `@tracelane/security`'s `scrapeResponseMeta` now reads
  `EventType.Custom` events (tag `tracelane.sec`) instead of console lines. The
  privacy invariant is unchanged: names + flags only, never header or cookie
  values.

- Updated dependencies [b688e07]
- Updated dependencies [b688e07]
- Updated dependencies [b688e07]
  - @tracelane/core@0.1.0-alpha.15
  - @tracelane/report@0.1.0-alpha.17

## 0.1.0-alpha.4

### Patch Changes

- 6ca4c92: Raise `engines.node` to `>=22` for the shared substrate and the tracelane
  packages, matching the monorepo root (`>=22.0.0`), `SUPPORTED.md` (which already
  lists all of these as **Node 22+**), and the dev setup documented in
  `CONTRIBUTING.md`.

  Unlike `@peekdev/*` — where Node 22 is a hard requirement because `better-sqlite3`
  only ships prebuilt binaries for Node 22+ — tracelane and `@cubenest/rrweb-core`
  have no native dependency and run on Node 20. This bump is a **support-baseline
  alignment**, not a technical necessity: it makes every published package's
  `engines` field agree with the support matrix instead of lagging at the old
  `>=20.18.0`, and formally drops Node 20 from the supported set while the project
  is still pre-1.0 alpha. The tracelane docs recipes were updated to state
  **Node >= 22** to match.

- Updated dependencies [6ca4c92]
  - @tracelane/core@0.1.0-alpha.14
  - @tracelane/report@0.1.0-alpha.16

## 0.1.0-alpha.3

### Patch Changes

- 89f5b13: README reframe: lead the npm landing page with the defensible differentiator.

  The previous hero leaned on "a self-contained HTML report," which isn't a
  unique claim — other reporters (e.g. monocart) ship a single HTML file too.
  The reframe leads instead with the combination that _is_ specific to tracelane:
  fully-inlined media **plus** rrweb **continuous** DOM session replay in a
  double-clickable, offline `file://` artifact.
  - Hero tagline rewritten around "one HTML file you can email — replays like a
    video on double-click," with a new "Why one file matters" block that names
    the `file://` / `show-trace` / `show-report` wedge honestly.
  - Output description, the "How it works" fixture bullet, and "What this is NOT"
    reframed around inlined-media + continuous-vs-snapshot framing.
  - No API, version, option, or behavior facts changed — content/positioning only.

- Updated dependencies [c066479]
  - @tracelane/core@0.1.0-alpha.13
  - @tracelane/report@0.1.0-alpha.15

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
