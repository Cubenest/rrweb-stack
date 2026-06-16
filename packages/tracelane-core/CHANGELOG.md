# @tracelane/core

## 0.1.0-alpha.16

### Patch Changes

- 759a39b: docs: correct the package taglines now that Playwright has shipped.

  The shared tagline still read "the reporter for your WebdriverIO tests —
  Playwright and Cypress on the roadmap." Playwright is now a published, supported
  adapter (reporter + fixture), so the npm-page taglines now read "the recorder
  for your WebdriverIO and Playwright tests — Cypress on the roadmap." Docs-only;
  no code change.

## 0.1.0-alpha.15

### Patch Changes

- b688e07: Make DOM capture resilient to navigation timing. On real (latency-bearing) cross-document navigations, the recorder's page-side re-injection could race the in-flight navigation, throw "Execution context was destroyed", and be silently swallowed — losing all rrweb DOM capture (FullSnapshot + mutations) on the new page while CDP-derived data still landed. `reinject` now retries past transient navigation-race errors (and `drain` skips a cycle instead of throwing), so recording reliably (re)starts on the navigated page. This restores replay + DOM-derived signals (e.g. the advisory mixed-content / reverse-tabnabbing security checks) on real sites.
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

- b688e07: Add an advisory, low-false-positive security-hygiene layer. A new `@tracelane/security` analyzer surfaces missing security headers, mixed content, insecure cookies, and reverse-tabnabbing as a collapsed "Security hygiene (advisory)" panel in the report and in the Copy-as-Markdown-for-AI output. On by default; disable with `security: false`; suppress findings via `tracelane.security.suppress.json`. Advisory only — not a security audit/scan. Capture is privacy-safe (security-header presence + cookie flags, never values).

## 0.1.0-alpha.14

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
  - @cubenest/rrweb-core@0.1.0-alpha.6

## 0.1.0-alpha.13

### Patch Changes

- c066479: fix(network): preserve the real HTTP method on failed responses

  `Network.responseReceived` derived the method from `response.requestHeaders`,
  which has no `:method` pseudo-header over HTTP/1.1 (the common case for dev/CI
  servers) and fell back to `GET`. A failed `POST`/`PUT`/`DELETE` therefore showed
  up as `GET` in the report's failed-network panel.

  The fix prefers the method already recorded at `Network.requestWillBeSent` (the
  same `inflight` correlation map the `loadingFailed` path uses), falling back to
  `methodOf(requestHeaders)` only when the request wasn't tracked. No-response
  failures and the `:method`/HTTP-2 path are unchanged.

## 0.1.0-alpha.12

### Patch Changes

- e250248: Fix post-navigation event loss in the Playwright adapter and harden navigation capture in the shared core.
  - **@tracelane/playwright**: the fixture now re-initializes rrweb recording on every main-frame navigation (previously all events after the first `page.goto` were silently dropped). Reporter options (`mode`/`outDir`/`captureNetwork`) are now honored by the fixture via the `TRACELANE_*` env vars. Capture is best-effort — a Content-Security-Policy that blocks script evaluation degrades gracefully instead of failing the test.
  - **@tracelane/core**: emit the `tracelane.nav` boundary marker on hard navigations (it was suppressed by a page-local session-id comparison); rescue pre-navigation buffered events across same-origin hard navigations via a `pagehide` → `sessionStorage` flush; lower the drain poll interval from 5000ms to 500ms.
  - **@tracelane/wdio**: inherits the core navigation-marker + drain-interval improvements (no API change).

  Docs corrected; tests now verify console/network/navigation data reaches the report (including a multi-page e2e that decodes the report and asserts post-navigation capture).

## 0.1.0-alpha.11

### Minor Changes

- 14aea8d: Hoist framework-agnostic adapter helpers (network-capture, report-writer, rrweb-bundle loader) into @tracelane/core and @tracelane/report so the WDIO and forthcoming Playwright adapters share one implementation. No behavior change for @tracelane/wdio.

## 0.1.0-alpha.10

### Patch Changes

- 6eb4046: Launch-readiness metadata + documentation accuracy fixes:
  - Add `bugs` and `engines.node` (`>=20.18.0`) to every published package.
  - Strip internal ticket references (ADR-NNNN) from user-facing strings (npm
    `description` fields and a CLI error message).
  - `@peekdev/mcp` README: replace the tool table with the real 10-tool surface
    and correct the permission model to the canonical 0–4 levels
    (Off / Read-only / Suggest-only / Act-with-confirm / YOLO) with the
    destructive-action blocklist as a cross-level override.
  - `@peekdev/cli` README: the MCP server exposes 10 tools (not "~20").
  - `@tracelane/cli`: repoint the dead Playwright/Cypress "coming soon" links to
    the live issues board, and qualify the hero tagline (WebdriverIO today;
    Playwright + Cypress on the roadmap).

- Updated dependencies [6eb4046]
  - @cubenest/rrweb-core@0.1.0-alpha.5

## 0.1.0-alpha.9

### Patch Changes

- cffccdb: Revamp the @tracelane/report HTML report UI — "Editorial Postmortem"
  aesthetic direction.

  The generated `.html` report has been reskinned end-to-end. Closes the
  Phase 6 candidate from launch plan §12 ("`@tracelane/report` UI revamp
  — surfaced 2026-05-29 during Gate B7 demo regen").

  **What changed for users:**

  The report opens to a forensic-grade investigation surface instead of a
  debug log with CSS on top. The failure message becomes the centerpiece
  (serif headline + a monospace stack trace below it), the player + panels
  sit side-by-side underneath with a custom timeline strip marking the
  failure point, and the panels gain filtering + tabbing. A floating
  "Copy as Markdown for AI" button replaces the toolbar pill.
  - Dark by default (no auto-toggle from `prefers-color-scheme`); off-white
    text on a dark slate background; amber-and-teal accents
  - Serif display headline (Fraunces Variable) reading
    `<test title> <em>failed</em>.` with italic emphasis on the verb
  - Verbatim error stack trace shown in a left-bordered `<pre>` block
    immediately below the headline
  - A 6-item `.meta-strip` (Spec / Duration / Commit / Build / Captured /
    Events) replacing the previous `<dl>`
  - Side-by-side replay column (rrweb-player at 60%) and a tabbed panels
    aside (Console / Network / Actions / Timeline) at 40%
  - Each panel has a per-pane filter input + a chip-based level filter
    (`errors` / `warn`) — the Console + Network panes are populated this
    pass; Actions + Timeline tabs ship as "coming soon" stubs that point
    the user at the rrweb-player scrubber
  - A custom timeline strip under the player shows the overall session
    range with a glowing amber failure marker at the end of the
    recording (pulse-on-load)
  - "Copy as Markdown for AI" is now a floating action button bottom-right
    that morphs into a checkmark on copy success and resets after 2s
  - Mobile-responsive at &lt;900px: replay stacks above panels, panels
    become full-width, tab bar scrolls horizontally if needed

  **Constraints preserved:**
  - Still a single self-contained HTML file
  - Still under the 25 MB cap (ADR-0005). New per-report cost: ~170 KB of
    base64-encoded woff2 fonts — well under 1% of the cap. The current
    demo report at `apps/tracelane-docs/public/demo/` weighs in at 338 KB,
    up from 170 KB.
  - Still no runtime fetch — both new fonts (Fraunces + JetBrains Mono)
    are inlined as `url(data:font/woff2;base64,…)` in the @font-face
    rules
  - Still Apache-2.0 compatible — both fonts are SIL OFL-1.1 licensed,
    added to NOTICE in this changeset

  **Implementation details:**
  - `template.ts` — full rewrite of `SHELL_CSS` and the body markup. The
    inline `BOOTSTRAP` JS picks up tab switching, per-pane filter
    handling, and the FAB success animation. Still ES5-ish so it runs in
    any browser without a build step.
  - `metadata.ts` — `renderMetaHeader` removed; replaced with `renderHero`
    which emits the new `<section class="hero">` shape (eyebrow strip +
    serif headline + error block + meta strip). The status pill keeps
    `class="status <status>"` so existing test assertions for that
    literal still pass.
  - `assets.ts` — three new loaders (`loadFrauncesNormal`,
    `loadFrauncesItalic`, `loadJetBrainsMonoNormal`) that read the
    variable woff2 files out of the `@fontsource-variable/*` packages
    and return base64 strings.
  - `build-report.ts` — computes `eventCount` + `firstTs` + `lastTs` from
    the sized event array and passes them into `ReportTemplateData` for
    the new timeline strip + meta-strip "Events" item.
  - `panels.ts` — unchanged extraction logic; the new rendering uses the
    already-extracted `timestamp` on each row for the per-row relative
    timestamps in the panels.
  - `node-shims.d.ts` — extended to declare `readFileSync(path)` (no
    encoding) returning a Buffer-like surface with `.toString('base64')`
    for the binary woff2 reads.

  **Verification:**
  - `pnpm --filter @tracelane/report typecheck` — clean
  - `pnpm --filter @tracelane/report test` — 61/61 pass (was 56; +5 in
    `metadata.test.ts` for the `renderHero` shape, 0 new failures
    elsewhere)
  - `pnpm -r typecheck` + `pnpm -r test` + `pnpm -r build` — all green
    across all packages
  - Demo regenerated: `apps/tracelane-docs/public/demo/acme-shop-checkout-failure.html`
    (338 KB, up from 170 KB; well under the 25 MB cap). Live at
    `https://tracelane.cubenest.in/demo/acme-shop-checkout-failure.html`
    once this lands + deploys.
  - `packages/tracelane-report/scripts/generate-demo.mjs` added so
    re-records are one command.

  **Dependency adds:**
  - `@fontsource-variable/fraunces@^5.2.7` (OFL-1.1)
  - `@fontsource-variable/jetbrains-mono@^5.2.7` (OFL-1.1)

  **Downstream `@tracelane/core` + `@tracelane/wdio` + `@tracelane/cli`
  get patch bumps for the dep refresh** — neither package's source
  changed but they share workspace versioning with `@tracelane/report`
  and consumers should pick up the new report look without a manual
  re-pin.

  **Scope cuts (deferred):**
  - Light-mode toggle — design works without it; can land as a follow-up
  - Actions panel content — tab exists as a "coming soon" stub; rrweb
    user-action extraction lands in a follow-up changeset
  - Richer Timeline panel — same; the under-player strip ships in this
    pass
  - "Copy frame as image" / inline screenshot diffs / per-tab persistent
    settings — flagged in the design doc but deliberately not in scope
  - rrweb-player chrome restyle — we use the player as-is

  Per launch plan §12 Phase 6 budget; non-blocking for the in-flight
  Phase 5 launch motion (this change doesn't affect tracelane's npm
  landing pages until the Version PR consumes it).

## 0.1.0-alpha.8

### Patch Changes

- 96a4b24: Add `keywords` and `funding` to every published package.json.

  All 7 packages previously shipped with empty `keywords: []` arrays and
  no `funding` field. The audit pass surfaced this as a discoverability
  gap on the npm side — npm search ranks heavily on keywords, and the
  "fund this package" badge only appears when `funding` is set in the
  manifest.

  Keywords picked per package to match real npm search intent (e.g.
  `rrweb`, `mcp`, `webdriverio`, `claude-code`, `session-replay`), 6–10
  each. Funding points uniformly at the GitHub Sponsors profile
  (`https://github.com/sponsors/harry-harish`) so npm renders the badge
  and `npm fund` resolves to a working URL across the whole monorepo.

  No code change; no API change. README and package source are
  unchanged. Patch bumps land the corrected metadata on the npm listing
  the next time the Version Packages PR is consumed.

  Companion changes (not visible on npm but shipped to the public repo
  in the same commit):
  - `.github/FUNDING.yml` (`github: [harry-harish]`) so the GitHub
    Sponsors button appears on the repo header
  - `.github/ISSUE_TEMPLATE/{config,bug,feature}.yml` so new issues are
    guided and the security path correctly redirects to GHSA
  - `.mcp.json` at repo root so the cursor.directory auto-detector can
    pick up peek when the maintainer submits the repo (per the
    Week 2-3 cursor.directory recipe shipped earlier today)
  - Repo description + topics updated via `gh repo edit` (separate
    audit-trail step, no commit needed)

- Updated dependencies [96a4b24]
  - @cubenest/rrweb-core@0.1.0-alpha.4

## 0.1.0-alpha.7

### Patch Changes

- 5e5674b: Strip broken `prds/*` cross-references from public-facing READMEs. The
  `prds/` directory (ADRs + PRDs + IMPLEMENTATION_PLAN) was authored in
  the maintainer's parent workspace but was never committed to the public
  repo — so every `[ADR-XXXX](prds/adrs/...)` link on the npm landing
  pages and the docs site was a 404 for visitors.

  Stripped 14 broken references across:
  - `packages/tracelane-core/README.md` — 3 ADR refs in "What's in here"
  - `packages/tracelane-wdio/README.md` — 3 ADR refs in "What this is NOT"
    - "How it works"
  - `packages/tracelane-report/README.md` — 1 PRD + 1 ADR ref in "Design"
  - `packages/rrweb-core/README.md` — 2 ADR-0002 refs ("What's in here" +
    "Versioning")
  - `docs/SUSTAINABILITY.md` — 2 refs ("No paid infrastructure" + "Source"
    bullets)
  - `docs/SECURITY-NOTES.md` — 1 Task 4.5 plan ref in "Source"
  - `apps/tracelane-docs/src/pages/index.astro` — 1 ADR-0006 ref in the
    "In-page rrweb buffer" feature card
  - Root `README.md` — 2 refs (already fixed in the previous commit
    alongside the hero-GIF wiring)

  In each case the surrounding prose stood on its own — the ADRs were
  cited as "see also" pointers, not as definitions of what's in the
  paragraph. The decisions the ADRs documented (BrowserExecutor abstraction,
  WDIO Service vs Reporter, 25 MB report cap, failed-only mode, rrweb fork
  choice, in-page buffer + Node-polled drain) remain implemented and the
  explanatory text remains intact.

  This is purely a public-facing-link cleanup; no API surface change, no
  behavior change. The package bumps land the corrected READMEs on npm.

  `.changeset/` and `CHANGELOG.md` historical entries referencing
  `docs/PHASE_5_LAUNCH_PLAN.md` or `prds/*` are intentionally left alone
  (frozen historical records).

- Updated dependencies [5e5674b]
  - @cubenest/rrweb-core@0.1.0-alpha.3

## 0.1.0-alpha.6

### Minor Changes

- 4cf481c: Wire the @cubenest/rrweb-core network plugin into @tracelane/wdio's
  recorder + @tracelane/report's panel extractor.

  @tracelane/wdio:
  - rrweb-bundle entry now includes getRecordNetworkPlugin alongside
    getRecordConsolePlugin.
  - Service registers the network plugin in record() when capture.network
    is true (default). New TraceLaneOptions.capture.networkOptions
    passthrough exposes the plugin's full option surface (recordBody,
    recordHeaders, maskRequestFn, etc.). PostHog-conservative defaults
    (bodies + headers off) inherit through.

  @tracelane/report:
  - panels.ts gains a branch extracting EventType.Plugin events with
    data.plugin === 'rrweb/network@1'. Maps to the existing NetworkEntry
    shape used by the report's network panel. Old EventType.Custom path
    (tracelane.test.network-error) remains as a fallback for sessions
    recorded with pre-alpha.2 substrate.

  @tracelane/core:
  - RecorderOptions gains networkPluginOptions (forwarded to the in-page
    rrweb network plugin alongside the existing console plugin). The in-page
    init script registers the plugin only when getRecordNetworkPlugin is
    present on window.rrweb, so older bundles silently skip it.
  - Public type NetworkPluginOptions exported.

  Closes T-7 from docs/qa/findings-2026-05-28.md — the WDIO-9 CDP-degraded
  network capture path no longer matters: the in-page plugin captures
  network events directly, framework-agnostic.

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies [7100b3f]
  - @cubenest/rrweb-core@0.1.0-alpha.2

## 0.1.0-alpha.4

### Patch Changes

- e73211d: Phase 5 launch-readiness: README hero rewrite for the npm landing pages.
  - `@peekdev/cli` + `@peekdev/mcp`: shipping a README for the first time.
    The alpha.x publishes to date had no README at all — npm rendered
    "no readme found" on the package pages. Both now lead with the locked
    peek tagline, install command above the fold, anti-positioning
    (not Sentry / not LogRocket / not a remote MCP), CLI subcommand
    reference + manual MCP-client config snippets.
  - `@tracelane/wdio`: full hero rewrite. Tagline + badges + 5-line
    install moved above the fold. "What this is NOT" section added.
    Existing technical content (full example, options table, hook-factory,
    network capture, FAQ) preserved below.
  - `@tracelane/core` + `@tracelane/report`: light touch — tagline
    header + stronger redirect to @tracelane/wdio for npm-search landers.

  Per the Phase 5 launch plan (docs/PHASE_5_LAUNCH_PLAN.md):
  - Gate B2 (first-paragraph, no marketing voice) → GREEN both products
  - Gate B3 (install command above the fold) → GREEN both products
  - Gate B1 (hero GIF) — vhs scaffold at assets/tracelane-hero.tape;
    recording pending. peek GIF lands Week 3-4.

## 0.1.0-alpha.3

### Patch Changes

- Phase 4c QA fix loop #2 — alpha.3 republishes against the 2026-05-28 walk:
  - **`@tracelane/wdio` rrweb recording empty** (T-9, showstopper) — the Service + hooks factory were re-injecting the recorder from `beforeCommand('url', ...)`, which fires BEFORE the navigation. The about-to-be-torn-down page got the bundle eval; the actual loaded page got nothing. Moved re-injection to `afterCommand('url', ...)` so rrweb lands on the new page. Verified end-to-end: the smoke fixture now captures 15+ events (FullSnapshot + interactions) where alpha.2 captured 0.
  - **`@peekdev/cli peek init` writes empty `allowed_origins`** (P-10, showstopper) — the shipped `extension-ids.json` has `PLACEHOLDER_*` strings for all three slots, which `allowedOrigins()` correctly drops, leaving the native-host manifest with `"allowed_origins": []`. Chrome then silently blocks `chrome.runtime.connectNative()` from the unpacked extension. The wizard now prompts for the locally-loaded extension ID (validated against Chrome's 32-char a–p shape) and overrides `extensionIds.dev` before building the manifest. Empty input is allowed (skip — only useful with a populated CWS slot).
  - **`@tracelane/wdio` `TraceLaneService` type incompatibility** (T-4) — the alpha.2 intersection fix on `options` was insufficient; the 2nd and 3rd constructor parameters were narrower than `Services.ServiceClass` requires. Widened to `Capabilities.ResolvedTestrunnerCapabilities` and `Options.Testrunner` so `services: [[TraceLaneService, { ... }]]` typechecks without `@ts-expect-error`.
  - **`@peekdev/cli peek --version` stale literal** (P-8) — `CLI_VERSION` was a hardcoded `0.1.0-alpha.0` string; it drifted as the package bumped to alpha.1 / alpha.2. Now read from `package.json` at runtime via `createRequire`, mirroring the alpha.2 fix to peek-mcp's `SERVER_VERSION`. Regression test pins them together.
  - **`@peekdev/extension` side-panel counters only updated on reload** (P-11) — the SW only injected the MAIN-world recorder from `chrome.tabs.onUpdated{ status: 'loading' }`. Enabling a site persisted the consent but left existing tabs un-instrumented until the user reloaded. Now also injects on `chrome.storage.onChanged` for `peek:enabledOrigins` — queries every currently-open tab of each newly-added origin and injects the recorder. Live counters now move as soon as the user enables a site and interacts with it.
  - **QA doc column-name bug** (P-12, doc-only) — `docs/qa/peek-qa.md` E.3 / E.4 referenced `started_at` on the `sessions` table; the actual column is `created_at`. Updated.

  Note: `@peekdev/extension` does not publish to npm (it's the unpacked / CWS-distributed Chrome extension), so it's not in the version bump list above — the P-11 fix is folded into the same alpha.3 wave for the maintainer's source tree but doesn't trigger an npm publish.

## 0.1.0-alpha.2

### Patch Changes

- Phase 4c QA fixes — republishes to address 3 install-blockers + 2 polish bugs found during manual QA:
  - **`workspace:*` not replaced in published deps** (all 5 packages) — the alpha.1 bootstrap used `npm publish` from each package directory, which doesn't resolve pnpm's workspace protocol. Fresh `pnpm install` / `npm install` of any of these alpha.1 packages fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` / `ERR_EUNSUPPORTEDPROTOCOL`. Alpha.2 ships via CI's `pnpm release` path which `changeset publish`-rewrites the protocol to a real version range before uploading.
  - **`@peekdev/cli` + `@peekdev/mcp` `invokedDirectly` guard** silently exits under pnpm's virtual store. `process.argv[1]` comes from the shallow `node_modules/<scope>/<pkg>/dist/index.js` shim path while `import.meta.url` resolves through the deep `.pnpm/…` symlink — they never compare equal, so the CLI runs but produces no output. Adds a `realpathSync` fallback.
  - **`@peekdev/mcp` `files` field** was missing `scripts/postinstall-guard.mjs` — the postinstall referenced it, so fresh installs hit `MODULE_NOT_FOUND`. Added.
  - **`@peekdev/mcp` `serverInfo.version`** was hardcoded to `0.1.0-alpha.0` and drifted; now read from `package.json` at runtime via `createRequire`. A scaffold regression test pins them together.
  - **`@tracelane/wdio` `TraceLaneService` constructor type** widened from `TraceLaneOptions` to `TraceLaneOptions & WebdriverIO.ServiceOption` so consumers' `wdio.conf.ts` typechecks without `// @ts-expect-error`.

## 0.1.0-alpha.1

### Patch Changes

- Updated dependencies
  - @cubenest/rrweb-core@0.1.0-alpha.1
