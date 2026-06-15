# @peekdev/mcp

## 0.1.0-alpha.20

### Patch Changes

- a52931a: Windows-hardening (Phase B): three fixes for installing and connecting the peek native host on Windows.
  - **Surface `reg.exe` failures instead of swallowing them** (`@peekdev/mcp`). The default registry-write sink ran `reg.exe add … /f` with `stdio: 'ignore'`, so when the HKCU write failed (locked/redirected hive, restricted token, EACCES) its stderr was discarded and the postinstall log showed a useless bare "Command failed". It now pipes stderr and rethrows a message that folds in `reg.exe`'s own stderr plus the exit status, so the per-target error the user sees is actionable.
  - **Resolve the home directory via `os.homedir()` in postinstall** (`@peekdev/mcp`). The postinstall path derived `home` from `process.env.HOME ?? process.env.USERPROFILE`, which on Git Bash for Windows picks up a POSIX `$HOME` (`/c/Users/jane`) that diverges from where Chrome/Edge actually read the host manifest. It now uses `os.homedir()` (which returns `%USERPROFILE%` on Windows), matching the `peek` CLI, and drops the empty-string fallback.
  - **Make the "run `peek init`" setup hint reachable from a stuck reconnect** (`@peekdev/extension`). When `connectNative` threw because the native host was never registered, the background state machine parked in `reconnecting` and never returned to `disconnected`, so the side panel showed a perpetual "Reconnecting…" pill and the setup hint (previously gated on `disconnected` only) was unreachable. The service worker now tracks consecutive failed reconnect attempts and the side panel surfaces the same "run `peek init`" guidance once the reconnect has been stalling long enough that the host is almost certainly unregistered.

- e8d0ca5: Honor `%LOCALAPPDATA%` when registering the Windows native-messaging host.

  `resolveInstallTargets` derived the Windows manifest location as
  `homeDir\AppData\Local`, ignoring the real `%LOCALAPPDATA%`. On machines where
  `AppData\Local` is redirected away from the user profile — OneDrive
  Known-Folder-Move, ADMX folder redirection, roaming/UNC profiles — the manifest
  was written to the wrong directory while the HKCU registry value pointed there
  too, so Chrome/Edge silently failed to find the native host (the extension
  could never connect).

  `resolveInstallTargets` now takes an optional `localAppData`, and both callers
  (`peek init` and the postinstall registrar) inject `process.env.LOCALAPPDATA`,
  falling back to `homeDir\AppData\Local` when it is unset.

- 1a45ef5: Fix two Windows-only failures found in the 2026-06-15 Windows-compatibility audit.

  **`peek` CLI was a silent no-op on Windows (critical).** The bin entry guard
  compared `import.meta.url` against the string-concatenated `` `file://${process.argv[1]}` ``.
  On Windows `process.argv[1]` is a backslash path (`C:\…\index.js`), so the
  concat produced the invalid url `file://C:\…\index.js`, which never equals
  `import.meta.url`'s RFC-8089 form (`file:///C:/…/index.js`). `invokedDirectly`
  was therefore always `false` and `main()` never ran — so `peek init`, `peek
status`, every command did nothing on Windows (and, with the native host never
  registered, the extension could never connect). The guard now uses
  `pathToFileURL` (new `isDirectInvocation` helper), which also fixes the same
  mismatch for paths containing spaces/unicode on POSIX. The identical guard in
  `@peekdev/mcp`'s `postinstall.ts` is fixed the same way.

  **better-sqlite3 load failure crashed the native host with no message (high).**
  `db/open.ts` imported `better-sqlite3` at top-level module scope, so its native
  `.node` binding loaded at module-evaluation time. A missing / ABI-mismatched
  (Node < 22) / antivirus-locked prebuild threw before `main()` could catch it —
  and stock Windows has no compile-from-source fallback — so the host process died
  and the browser saw a silently-closed stdio pipe. The import is now type-only
  and the constructor is loaded lazily (`loadBetterSqlite3`), deferring the load
  into `openDb()` and wrapping failures in an actionable error that names the
  Node 22+ requirement, the platform/arch, and the likely cause.

## 0.1.0-alpha.19

### Patch Changes

- 4d3f36d: Part 2 — assisted-apply: add set_intent (agent-set control-shield banner string)
  and request_user_input scope:'page' (full-page takeover for CAPTCHAs / native
  widgets / the final review-and-submit, atop the existing field-scope handoff),
  plus a supervised assisted-apply recipe (draft). page-scope inherits the handoff
  recording-suspension; the recipe states the LinkedIn-ToS + recording-residual
  honesty plainly.
- 3c4e042: Audit completeness: redactActionForAudit now records `scope` for request_user_input
  entries, so a page-scope full-takeover is distinguishable from a field/free-text
  card in ~/.peek/audit.log. Still never records the returned value (or readBack/
  timeoutMs); scope is non-secret.
- 877d35a: Add the input handoff (request_user_input): while the Level-4 control shield is
  up, the agent can pause and hand the keyboard back to the user for one editable,
  non-destructive field (or a free-text prompt), then resume. The returned value
  is opt-in (readBack) and never for password/OTP/cc fields; rrweb forwarding is
  suspended for the tab during the handoff (incremental channel; the FullSnapshot
  residual is documented). Approver is `user`; audit records prompt + selector only.

## 0.1.0-alpha.18

### Patch Changes

- aa79091: feat: implement the Level-2 "Suggest" tier — MCP-driven DOM highlight overlay

  peek-mcp:
  - `suggest_element` (selector, optional label) — draws a non-destructive highlight overlay on an element in the live browser, to point something out without changing the page. Available at per-origin permission Level 2 (Suggest) and above.
  - `clear_highlight` — removes the active overlay. Idempotent.
  - New `highlight` / `clear_highlight` action schemas; new honest `level-2-suggest` audit approver.

  Extension:
  - Self-contained MAIN-world `applyHighlight` / `clearHighlight` overlay functions (fixed-position ring + optional label badge, re-anchored on scroll/resize, replace-on-reapply, persists until cleared).
  - The SW auto-allows highlight/clear_highlight at Level 2+ via a dedicated non-mutating path — no destructive check, no confirm banner, no token. Levels 0/1 deny.

  This activates the previously-reserved Level-2 "Suggest-only" tier.

## 0.1.0-alpha.17

### Patch Changes

- 209c1b3: feat: implement all remaining execute_action verbs (back/forward/reload/waitFor/screenshot/enter/dblclick) and fix screenshot capture

  Extension:
  - `back` / `forward` / `reload` — history navigation verbs in the MAIN-world dispatcher
  - `waitFor` — MutationObserver + timeout race; waits for a selector to attach or a pure delay
  - `screenshot` — CDP `Page.captureScreenshot` via the already-declared `debugger` permission (replaces `captureVisibleTab` which requires `<all_urls>` / an `activeTab` user gesture unavailable in the MCP→native-host→SW call path)
  - `enter` — dispatches keydown/keypress/keyup with key=Enter on a selector or the active element; triggers native form submission in most frameworks
  - `dblclick` — dispatches a `dblclick` MouseEvent on a resolved selector

  peek-mcp:
  - Adds `EnterActionSchema` and `DblClickActionSchema` to the Zod `ActionSchema` union so the MCP tool surfaces both verbs to AI clients
  - `writeScreenshotFile`: host-socket spills the screenshot `dataUrl` to `~/.peek/screenshots/<requestId>.png` (0600) and returns a path pointer instead of a multi-MB base64 blob in the MCP context

## 0.1.0-alpha.16

### Minor Changes

- 07534d5: Improve generated Playwright repros: coalesce duplicate navigations and double-fired clicks, collapse typing bursts to the final value, element-type-aware actions (checkbox→check/uncheck, skip hidden/file inputs), and assert the final URL (`toHaveURL`). Does NOT yet recover Enter-to-submit / search intent (tracked separately).

### Patch Changes

- 500e976: get_session_summary now reports `hasReplay`/`eventCount` and warns when a session captured no DOM/replay events (e.g. recorded with Deep capture / chrome.debugger attached, which currently suppresses rrweb capture) — so replay-less sessions are visible instead of silently looking healthy.

## 0.1.0-alpha.15

### Patch Changes

- 96c9225: Enrich MCP tool definitions — per-parameter descriptions, behavioral
  annotations (readOnly/destructive/openWorld hints), and clearer tool
  descriptions disclosing output shape, result caps, and cross-tool usage.
  Improves agent tool-selection and the Glama quality score; no behavior change.

## 0.1.0-alpha.14

### Patch Changes

- 6ca4c92: Fix peek MCP server failing to start on Windows (two independent causes).
  1. **npx couldn't resolve the package.** The canonical `mcpServers.peek` block
     `peek init` writes (and the README's manual snippet) used a bare
     `npx -y @peekdev/mcp`. While peek is in alpha, every published version is a
     prerelease (`0.1.0-alpha.*`), and the implicit `*` range npx resolves does
     not match prereleases per semver — npx fails with `ETARGET: No matching
version found for @peekdev/mcp@*`, so the MCP client reports a connection
     error (`-32000`). The canonical block now pins `@peekdev/mcp@latest`, which
     forces the newest published dist-tag.
  2. **No Node 20 prebuilt for the native dependency.** `better-sqlite3@12.x`
     ships win32-x64 prebuilt binaries only for Node 22+ (ABI v127+); on Node 20
     (ABI v115) `prebuild-install` 404s and falls back to compiling from source,
     which fails on a stock Windows box (no MSVC C++ toolchain). macOS hid this
     because it ships a compiler. `engines.node` for both `@peekdev/mcp` and
     `@peekdev/cli` is raised to `>=22` (matching the monorepo root and where
     better-sqlite3 actually publishes prebuilts), and the requirement is now
     documented in the README.

- 32aa73c: `generate_playwright_repro` now emits `page.selectOption()` for `<select>` inputs instead of `page.fill()`, producing runnable specs for dropdown interactions.
- Updated dependencies [6ca4c92]
  - @cubenest/rrweb-core@0.1.0-alpha.6

## 0.1.0-alpha.14

### Patch Changes

- 64e4f55: Fix mcpName casing: use io.github.Cubenest/peek-mcp (uppercase C) to match the GitHub organisation namespace granted by the MCP Registry. The lowercase variant caused a 403 at registry publish time.

## 0.1.0-alpha.13

### Minor Changes

- 4633f96: Wire the execute_action write-path end-to-end: a LocalSocketHostBridge (MCP process) ↔ HostSocketServer (native host) over ~/.peek/host.sock, a MAIN-world action dispatcher (click/type/navigate/scroll), a side-panel confirm banner, and confirmToken consumption that skips the banner. The write PATH is now implemented end to end — but write access stays OFF by default. peek remains read-only (Level 1) for every origin until you opt in per-origin to Level 3 (act-with-confirm) or Level 4 (YOLO). At Level 3 every action surfaces the side-panel confirm banner before it runs (Allow once / Always for this site / Deny); a prior request_authorization issues a one-shot confirmToken, bound to the exact action, that lets the next execute_action skip the banner. The destructive-action blocklist overrides every level. Level 2 highlight and the remaining actions are queued.

### Patch Changes

- 77f1107: Add `mcpName` (`io.github.cubenest/peek-mcp`) to package.json and a `server.json`, enabling publication to the official MCP Registry.

  The registry verifies npm package ownership by reading the `mcpName` field from the **published** package at the exact version referenced in `server.json` — so this field must ship in the package (this release) before the server can be listed via `mcp-publisher publish`.

## 0.1.0-alpha.12

### Patch Changes

- 20e8471: Docs-only: 4 README accuracy fixes against source of truth.
  - Acknowledge that the cross-process IPC bridge for `execute_action` /
    `request_authorization` (the `LocalSocketHostBridge`) is in development;
    alpha.11 returns `bridge not wired in this MCP process` on those calls,
    so peek is effectively read-only today. Same honest framing as the
    per-action-approval recipe.
  - Correct Claude Code config path (`~/.claude.json`, not
    `~/.claude/mcp_servers.json`); add a canonical-paths table sourced from
    `packages/peek-cli/src/lib/init-config.ts` so the README stays in sync
    with the wizard.
  - Replace the nonexistent `startNativeHost` subpath-export example with
    `buildManifest` + `installManifests` (which are the actual exports).
  - Drop the `PEEK_HOME=~/.peek` example value (it's the default, so setting
    it was a no-op) and replace with a one-line note explaining when to
    override.

  No API changes; bump exists solely to push the corrected README to npm.

## 0.1.0-alpha.11

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

## 0.1.0-alpha.10

### Patch Changes

- f7e8449: Fix `loadSessionEvents` so `get_dom_snapshot`, `get_user_action_before_error`,
  `query_dom_history`, and `generate_playwright_repro` actually load events from
  the on-disk layout the native host writes.

  The writer stores one gzipped chunk per `session.append` batch at
  `<peek-home>/rrweb-events/<sessionId>/<seq>.json.gz` and writes the per-session
  directory into `sessions.events_blob_path`. The reader had two problems on that
  layout:
  1. It called `readFileSync` on `events_blob_path`, which is a directory — node
     threw `EISDIR`, the catch wrapped it as `SessionEventsError("corrupt or
truncated recording")`, and the event-walker tools surfaced that as
     "no FullSnapshot / DOM can't be reconstructed" — even though the
     FullSnapshot was sitting in `0.json.gz` the whole time.
  2. The writer prepended an extra `rrweb-events/` segment to the stored path,
     which the reader's base directory already included, producing a path that
     doesn't exist.

  `loadSessionEvents` now detects the directory layout, walks
  `<seq>.json.gz` files in numeric seq order, decompresses each, and concatenates
  the event arrays. Single-file blobs (older rows / tests) still work.
  `resolveBlobPath` strips a leading `rrweb-events/` segment when present so
  existing user data written before the writer fix still loads.

## 0.1.0-alpha.9

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

- be1290b: Document MCP-registry submission paths in the package README.

  Added a maintainer-facing "Distribution" section to `packages/peek-mcp/README.md`
  linking to the four pre-filled registry-submission scaffolds at
  `docs/peek/distribution/`:
  - the official MCP Registry (`registry.modelcontextprotocol.io`) via the
    `mcp-publisher` CLI + a `server.json`;
  - PulseMCP (URL-only submission form + auto-ingest from the MCP Registry);
  - Smithery (MCPB bundle upload via `smithery mcp publish`);
  - mcp.so (web-form submission backed by Supabase);

  …plus the standalone Claude Code skill install recipe.

  The four scaffolds themselves were re-audited against each registry's
  2026-05-30 schema (separate work — no code change, no `@peekdev/*` API
  change). README change only; bumping `@peekdev/mcp` to keep the npm
  listing's metadata aligned with the doc set being published alongside
  the Phase 5 launch.

- Updated dependencies [96a4b24]
  - @cubenest/rrweb-core@0.1.0-alpha.4

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [5e5674b]
  - @cubenest/rrweb-core@0.1.0-alpha.3

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies [7100b3f]
  - @cubenest/rrweb-core@0.1.0-alpha.2

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

## 0.1.0-alpha.4

### Patch Changes

- 15e4f8c: Phase 4c alpha.7 cleanups — close the 3 remaining annoyances from the
  manual QA walk (docs/qa/findings-2026-05-28.md):
  - J.6 (peek-extension + peek-mcp): rrweb recorder now emits a fresh
    FullSnapshot every 2 minutes (checkoutEveryNms: 120_000) and every
    5000 events. Bounds the look-back window for get_dom_snapshot so AI
    tools get a reconstructed DOM at the error timestamp even when the
    error fires deep into a long-running session.
  - K.2 (peek-cli + peek-mcp): `peek sessions export --format playwright`
    now wires through to the same `generatePlaywrightRepro` code path that
    the MCP `generate_playwright_repro` tool uses. CLI + AI consumers get
    identical output for the same session. peek-mcp gains
    `./mcp/playwright-repro` and `./mcp/event-blobs` subpath exports.
  - P-18 (peek-cli): `peek sessions list --json` outputs machine-readable
    JSON; `peek sessions list --help` prints usage and exits 0. parseArgs
    no longer crashes on unknown flags. Same `--help` treatment extended
    to show / export / delete / audit subcommands; each has a
    subcommand-specific usage block.

  peek-extension stays private (no npm publish); peek-cli and peek-mcp
  republish via OIDC.

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
