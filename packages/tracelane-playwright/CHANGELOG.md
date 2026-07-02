# @tracelane/playwright

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies [5c736d4]
- Updated dependencies [a10c445]
  - @tracelane/core@0.1.0-alpha.18
  - @tracelane/report@0.1.0-alpha.21

## 0.1.0-alpha.8

### Patch Changes

- 69cd9c1: docs: normalize README badge rows across all published packages.

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

- db8d39b: docs: non-badge README fixes from the public-doc audit.

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

- Updated dependencies [69cd9c1]
- Updated dependencies [db8d39b]
  - @tracelane/core@0.1.0-alpha.17
  - @tracelane/report@0.1.0-alpha.20

## 0.1.0-alpha.7

### Minor Changes

- 33dbf43: Capture network on every browser, not just Chromium.

  The Playwright adapter previously captured network only via CDP, so on
  Firefox/WebKit the network panel was always empty — even though the shared
  `@tracelane/core` recorder already supports the framework-agnostic in-page
  `rrweb/network@1` plugin (which `@tracelane/wdio` uses as its primary channel).

  `runStart` now wires that in-page plugin (privacy-first defaults: URL/method/
  status/timing, headers + bodies off) whenever `captureNetwork` is enabled, so
  network capture works on Chromium, Firefox, and WebKit alike. On Chromium the
  existing CDP path still runs and enriches the in-page rows with authoritative
  status + true no-response failures (the report merges them, real status wins).
  `captureNetwork: false` now disables both channels.

- c818aab: Close three option-parity gaps with `@tracelane/wdio`:
  - **Security opt-out + suppression file.** New `security` option (default `true`,
    env `TRACELANE_SECURITY`) disables both the `[tracelane.sec]` capture and the
    report-side analysis. A `tracelane.security.suppress.json` file in the working
    directory is loaded at report-write time to silence known-acceptable signals
    (missing/malformed file never throws).
  - **Capture-channel toggles + network/console masking.** New nested
    `capture: { rrweb, network, console, networkOptions }` plus top-level
    `consolePluginOptions`. `capture.rrweb: false` records nothing and writes no
    report; `capture.console: false` patches no `console.*`. The legacy top-level
    `captureNetwork` still works but is deprecated in favor of `capture.network`.
    Masking options (`capture.networkOptions`, `consolePluginOptions`) bridge to
    the fixture worker as JSON. Env: `TRACELANE_CAPTURE_RRWEB`,
    `TRACELANE_CAPTURE_CONSOLE`, `TRACELANE_NETWORK_OPTIONS`,
    `TRACELANE_CONSOLE_OPTIONS`. Note: function-valued mask props (`maskRequestFn`,
    `maskResponseFn`) cannot cross the worker-process env bridge and are not
    supported via reporter config.
  - **Report footer opt-out + drain/cooldown tuning.** New `report: { footer }`
    (env `TRACELANE_FOOTER`), `drainIntervalMs` (env `TRACELANE_DRAIN_INTERVAL_MS`),
    and `cooldownMs` (env `TRACELANE_COOLDOWN_MS`).

### Patch Changes

- Updated dependencies [759a39b]
  - @tracelane/core@0.1.0-alpha.16
  - @tracelane/report@0.1.0-alpha.19

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
