# @tracelane/wdio

## 0.1.0-alpha.17

### Patch Changes

- e250248: Fix post-navigation event loss in the Playwright adapter and harden navigation capture in the shared core.
  - **@tracelane/playwright**: the fixture now re-initializes rrweb recording on every main-frame navigation (previously all events after the first `page.goto` were silently dropped). Reporter options (`mode`/`outDir`/`captureNetwork`) are now honored by the fixture via the `TRACELANE_*` env vars. Capture is best-effort — a Content-Security-Policy that blocks script evaluation degrades gracefully instead of failing the test.
  - **@tracelane/core**: emit the `tracelane.nav` boundary marker on hard navigations (it was suppressed by a page-local session-id comparison); rescue pre-navigation buffered events across same-origin hard navigations via a `pagehide` → `sessionStorage` flush; lower the drain poll interval from 5000ms to 500ms.
  - **@tracelane/wdio**: inherits the core navigation-marker + drain-interval improvements (no API change).

  Docs corrected; tests now verify console/network/navigation data reaches the report (including a multi-page e2e that decodes the report and asserts post-navigation capture).

- Updated dependencies [e250248]
  - @tracelane/core@0.1.0-alpha.12
  - @tracelane/report@0.1.0-alpha.14

## 0.1.0-alpha.16

### Minor Changes

- 14aea8d: Hoist framework-agnostic adapter helpers (network-capture, report-writer, rrweb-bundle loader) into @tracelane/core and @tracelane/report so the WDIO and forthcoming Playwright adapters share one implementation. No behavior change for @tracelane/wdio.

### Patch Changes

- Updated dependencies [14aea8d]
  - @tracelane/core@0.1.0-alpha.11
  - @tracelane/report@0.1.0-alpha.13

## 0.1.0-alpha.15

### Minor Changes

- 6eb4046: Launch-readiness fixes to the WebdriverIO reporter Service:
  - **`report: { footer: false }` opt-out** is now real — the option is threaded
    through to the report template so the attribution footer can be suppressed
    (it was documented but previously had no effect).
  - **Capture true network failures.** The CDP path now also subscribes to
    `Network.loadingFailed`, so genuine no-response errors (CORS failure, offline,
    abort → status 0) surface in the Network panel, correlated back to their HTTP
    method. Previously only `responseReceived` (status ≥ 400) was captured.
  - **Docs corrected.** The network-capture section + browser matrix now lead with
    the default CDP-independent in-page `rrweb/network@1` plugin (works on
    Firefox/Safari/cloud-Selenium), with CDP as an enhancement; the options
    JSDoc accurately describes default (PerformanceObserver-only) behavior.
  - **Fix hook-factory example.** The README wired a non-existent `beforeCommand`;
    it now correctly uses `afterCommand` for post-navigation re-injection.

### Patch Changes

- Updated dependencies [6eb4046]
- Updated dependencies [6eb4046]
  - @tracelane/core@0.1.0-alpha.10
  - @tracelane/report@0.1.0-alpha.12

## 0.1.0-alpha.14

### Patch Changes

- Updated dependencies [748ef2f]
  - @tracelane/report@0.1.0-alpha.11

## 0.1.0-alpha.13

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

- Updated dependencies [cffccdb]
- Updated dependencies [69bde17]
  - @tracelane/report@0.1.0-alpha.10
  - @tracelane/core@0.1.0-alpha.9

## 0.1.0-alpha.12

### Patch Changes

- e734583: Wire up docs subdomains now that `tracelane.cubenest.in` + `peek.cubenest.in`
  are live on Vercel (both returning HTTP/2 200, served via fresh CNAMEs to
  `cname.vercel-dns.com`, deployed from the same `Cubenest/rrweb-stack` repo
  that publishes these npm packages).

  Per-package change is identical and minimal:
  - Insert a single `Docs: <hosted-url>` line in the README right below the
    hero GIF / above-the-fold install snippet.
  - Update `package.json` `homepage` to point at the deployed docs site
    instead of the GitHub README. The previous recursive
    `github.com/.../tree/main/packages/<name>#readme` value was correct but
    awkward (npm landing page → GitHub README → which then linked back to
    install instructions); now the npm landing page's "homepage" link goes
    straight to the right product's docs.

  | Package           | Docs URL                        |
  | ----------------- | ------------------------------- |
  | `@tracelane/wdio` | <https://tracelane.cubenest.in> |
  | `@tracelane/cli`  | <https://tracelane.cubenest.in> |
  | `@peekdev/cli`    | <https://peek.cubenest.in>      |
  | `@peekdev/mcp`    | <https://peek.cubenest.in>      |

  Companion (non-published) changes shipped in the same commit:
  - Root `README.md` "Docs:" lines updated from relative `apps/*-docs/`
    links to the hosted URLs, with the source-tree path kept in
    parentheses for contributors.
  - GitHub repo `homepageUrl` set to `https://cubenest.in` via
    `gh repo edit Cubenest/rrweb-stack --homepage` (the umbrella, not
    one of the two products — both are equally first-class).
  - `assets/og-card.png` committed as the canonical social-preview source
    (1200×630, 32 KB, generated from the captured prompt). Repo-level
    GitHub social-preview upload (Settings → Social preview) is a separate
    one-click action by the maintainer — the file is committed so re-uploads
    - re-renders are reproducible.
  - `assets/README.md` updated to list `og-card.png` alongside the hero
    GIF assets.

  `@cubenest/rrweb-core`, `@tracelane/core`, and `@tracelane/report` are
  intentionally NOT in this changeset — their READMEs didn't need
  Docs links (they're "internal substrate" packages that disclaim direct
  consumption), and their `homepage` fields pointing at the GitHub README
  remain appropriate for the shared-substrate framing.

## 0.1.0-alpha.11

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
  - @tracelane/core@0.1.0-alpha.8
  - @tracelane/report@0.1.0-alpha.9

## 0.1.0-alpha.10

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
  - @tracelane/core@0.1.0-alpha.7
  - @tracelane/report@0.1.0-alpha.8

## 0.1.0-alpha.9

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

### Patch Changes

- Updated dependencies [4cf481c]
  - @tracelane/report@0.1.0-alpha.7
  - @tracelane/core@0.1.0-alpha.6

## 0.1.0-alpha.8

### Patch Changes

- @tracelane/core@0.1.0-alpha.5
- @tracelane/report@0.1.0-alpha.6

## 0.1.0-alpha.7

### Patch Changes

- a738dc8: **Fix shipped READMEs: `npx tracelane init` 404'd because npx's auto-install
  heuristic looks for an unscoped package matching the command name.** The
  package is published as `@tracelane/cli` so `npx tracelane init` would do
  `npm install tracelane` → 404 → fatal exit. Users following the README
  landed on a broken install path.

  This patch corrects every live reference to use the working scoped form:

  ```sh
  npx @tracelane/cli init
  ```

  Updated:
  - `@tracelane/cli` README + `init --help` Usage string (both forms shown:
    the one-off `npx @tracelane/cli init` and the after-`npm install` short
    form `tracelane init`).
  - `@tracelane/wdio` README (top-of-page hero install snippet + the
    follow-up paragraph that links to the wedge amplifier).
  - Root `README.md` (not bumped — repo file, not a package; the products
    table's tracelane install column).
  - `apps/tracelane-docs/src/pages/demo.astro` (the demo page's "get the
    real thing into your CI" snippet).
  - `docs/posts/origin-story.md` (the maintainer's draft for harish.dev).

  Also lands Gate B1 hero GIF — `assets/tracelane-hero.gif` (812 KB,
  under the 6 MB launch-plan ceiling), captured via vhs against a real
  WDIO fixture in `/tmp/tracelane-hero-demo`. The recording shows the full
  `npx @tracelane/cli init` flow: detects WDIO + npm, installs
  `@tracelane/wdio`, edits `wdio.conf.ts`, creates `tracelane-reports/`,
  appends to `.gitignore`. The `@tracelane/wdio` README now references the
  GIF via the absolute raw.githubusercontent.com URL so the npm landing
  page renders it correctly.

  The vhs tape (`assets/tracelane-hero.tape`) + the staging script
  (`assets/record-tracelane-hero.sh`) are committed so future re-records
  are a single command: `bash assets/record-tracelane-hero.sh`.

  Defensive squat of the unscoped `tracelane` package name on npm is
  deferred — `tracelane` is currently available (`npm view tracelane`
  returns 404) but publishing a stub there would add a maintenance surface
  we don't need yet. Tracked for post-1.0.

## 0.1.0-alpha.6

### Patch Changes

- 83fdf1d: Phase 5 wedge amplifier wiring: lead READMEs with `npx tracelane init` as the
  canonical install path, per the launch plan §4.6 ("Every README must lead with
  the install command, get it short, get it right, get it above the fold").
  - `@tracelane/wdio`: top-of-README now shows `cd your-wdio-project && npx tracelane init`
    as the one-line install. The previous manual `npm install --save-dev @tracelane/wdio`
    - hand-edited conf snippet is preserved under "Or wire it manually" for users who
      want to know what's happening (and for CI scripts that can't run an interactive prompt).
  - `@tracelane/cli`: brand-continuity touch — the broader product tagline now leads
    the README above the CLI-specific tagline, so npm searches landing on this
    package immediately see the tracelane family identity.
  - Root `README.md` (not bumped — repo file, not a package): the product table's
    tracelane install column updated to `npx tracelane init`.

  Also exercises the new `@tracelane/cli` Trusted Publisher configured 2026-05-29
  after the bootstrap publish — if this OIDC release succeeds, future CI publishes
  need no manual intervention.

## 0.1.0-alpha.5

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

- Updated dependencies [e73211d]
  - @tracelane/core@0.1.0-alpha.4
  - @tracelane/report@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies
  - @tracelane/report@0.1.0-alpha.4

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

- Updated dependencies
  - @tracelane/core@0.1.0-alpha.3
  - @tracelane/report@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Phase 4c QA fixes — republishes to address 3 install-blockers + 2 polish bugs found during manual QA:
  - **`workspace:*` not replaced in published deps** (all 5 packages) — the alpha.1 bootstrap used `npm publish` from each package directory, which doesn't resolve pnpm's workspace protocol. Fresh `pnpm install` / `npm install` of any of these alpha.1 packages fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` / `ERR_EUNSUPPORTEDPROTOCOL`. Alpha.2 ships via CI's `pnpm release` path which `changeset publish`-rewrites the protocol to a real version range before uploading.
  - **`@peekdev/cli` + `@peekdev/mcp` `invokedDirectly` guard** silently exits under pnpm's virtual store. `process.argv[1]` comes from the shallow `node_modules/<scope>/<pkg>/dist/index.js` shim path while `import.meta.url` resolves through the deep `.pnpm/…` symlink — they never compare equal, so the CLI runs but produces no output. Adds a `realpathSync` fallback.
  - **`@peekdev/mcp` `files` field** was missing `scripts/postinstall-guard.mjs` — the postinstall referenced it, so fresh installs hit `MODULE_NOT_FOUND`. Added.
  - **`@peekdev/mcp` `serverInfo.version`** was hardcoded to `0.1.0-alpha.0` and drifted; now read from `package.json` at runtime via `createRequire`. A scaffold regression test pins them together.
  - **`@tracelane/wdio` `TraceLaneService` constructor type** widened from `TraceLaneOptions` to `TraceLaneOptions & WebdriverIO.ServiceOption` so consumers' `wdio.conf.ts` typechecks without `// @ts-expect-error`.

- Updated dependencies
  - @tracelane/core@0.1.0-alpha.2
  - @tracelane/report@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- @tracelane/core@0.1.0-alpha.1
- @tracelane/report@0.1.0-alpha.1
