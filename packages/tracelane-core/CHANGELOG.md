# @tracelane/core

## 0.1.0-alpha.7

### Patch Changes

- e12fb25: Strip broken `prds/*` cross-references from public-facing READMEs. The
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
  (frozen historical records; same rule that applied during the
  2026-05-30 audit cleanup at commit 8bc1352-era).

- Updated dependencies [e12fb25]
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
