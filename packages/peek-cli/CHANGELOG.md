# @peekdev/cli

## 0.1.0-alpha.24

### Patch Changes

- Updated dependencies [aa79091]
  - @peekdev/mcp@0.1.0-alpha.18

## 0.1.0-alpha.23

### Patch Changes

- Updated dependencies [209c1b3]
  - @peekdev/mcp@0.1.0-alpha.17

## 0.1.0-alpha.22

### Patch Changes

- Updated dependencies [07534d5]
- Updated dependencies [500e976]
  - @peekdev/mcp@0.1.0-alpha.16

## 0.1.0-alpha.21

### Patch Changes

- Updated dependencies [96c9225]
  - @peekdev/mcp@0.1.0-alpha.15

## 0.1.0-alpha.20

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

- Updated dependencies [6ca4c92]
- Updated dependencies [32aa73c]
  - @peekdev/mcp@0.1.0-alpha.14

## 0.1.0-alpha.19

### Patch Changes

- Updated dependencies [64e4f55]
  - @peekdev/mcp@0.1.0-alpha.14

## 0.1.0-alpha.18

### Patch Changes

- Updated dependencies [77f1107]
- Updated dependencies [4633f96]
  - @peekdev/mcp@0.1.0-alpha.13

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies [20e8471]
  - @peekdev/mcp@0.1.0-alpha.12

## 0.1.0-alpha.16

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
  - @peekdev/mcp@0.1.0-alpha.11

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [f7e8449]
  - @peekdev/mcp@0.1.0-alpha.10

## 0.1.0-alpha.14

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

- 113accd: Embed peek hero GIF at the top of the @peekdev/cli npm landing page.

  Closes the Gate B1 peek hero requirement from launch plan §3.2 (Week
  3-4). Hero shows the read side of peek's value: a recorded browser
  session as queryable, structured output. The 15-second flow:

  $ peek sessions list
  → 3 recent sessions (shop.example.com checkout, localhost:3000
  dashboard, github.com docs read) with error counts

  $ peek sessions show s_demo_checkout --format markdown
  → markdown summary with console errors (Stripe.js loaded twice +
  404 from /api/checkout/confirm), network errors (404 + 500),
  and the indirect-virality attribution footer

  $ peek sessions show s_demo_checkout --format json | head -28
  → JSON envelope with the top-level `_attribution` block

  The install half (`npx peek init`) is covered in the README install
  code block; the wizard's interactive multiSelect prompts don't record
  cleanly in vhs inside the 15-second budget.

  Asset is ~660 KB (under the 6 MB Gate B1 ceiling). 1200x720, no
  narration, no Claude Code chat UI -- terminal-only.

  Scaffolding shipped alongside (in `assets/`):
  - `peek-hero.tape` -- the vhs script
  - `record-peek-hero.sh` -- driver that builds @peekdev/cli from the
    monorepo, seeds three synthetic sessions in a /tmp fixture
    sessions.db (never touches the maintainer's real ~/.peek), and
    invokes vhs. Re-records are one command.

  Root README also picks up the peek GIF alongside tracelane's, replacing
  the "peek's equivalent hero GIF lands in a future launch motion chunk"
  placeholder text.

  Docs only; no @peekdev/cli code change. Patch bump lands the embedded
  image on the npm landing page.

- Updated dependencies [e734583]
  - @peekdev/mcp@0.1.0-alpha.9

## 0.1.0-alpha.13

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

- d1879ac: Document the project-level Cursor `.cursor/mcp.json` recipe.

  `peek init` writes Cursor's MCP server block to the global config at
  `~/.cursor/mcp.json`. Some users prefer to scope peek per-project — a
  project-level `.cursor/mcp.json` at the workspace root is the supported
  alternative. New README subsection under "Supported AI clients" walks
  through the trade-off (global vs project), shows the exact JSON, and
  points to `peek init --skip-clients` as the way to install the native
  messaging host without writing any MCP config.

  The recipe is documentation only — no code changes to `@peekdev/cli`.
  The block shown in the README is byte-identical to `PEEK_MCP_BLOCK` in
  `src/lib/init-config.ts`, so the two configs remain interchangeable.

  Companion artifact at `docs/peek/distribution/cursor-directory-submission.md`
  documents the (maintainer-side) cursor.directory submission flow: the
  2026 migration from `pontusab/cursor.directory` to
  `cursor/community-plugins` switched the contract from "open a PR" to
  "submit the repo URL via the web form and let the auto-detector find
  `.mcp.json` at repo root." The doc captures the exact `.mcp.json` shape
  to ship on `Cubenest/rrweb-stack` and the per-launch checklist before
  the maintainer triggers the submission.

  Per launch plan §3.2, this is the Week 2-3 peek/Cursor ship.

- Updated dependencies [96a4b24]
- Updated dependencies [be1290b]
  - @peekdev/mcp@0.1.0-alpha.8

## 0.1.0-alpha.12

### Patch Changes

- ff97a1c: Ship Claude Code Skill for peek.

  `peek init` now drops a SKILL.md into `~/.claude/skills/peek/SKILL.md` when
  Claude Code is among the configured clients or `~/.claude.json` already
  exists. The skill teaches Claude Code _when_ to reach for peek's MCP tools
  (investigating an error from a manual repro, generating a Playwright test
  from a session, querying DOM state at a past moment, "what was the user
  doing before X failed", etc.) — complementary to the `mcpServers.peek`
  block that exposes the tools themselves.

  The skill documents the 10 MCP tools (`list_recent_sessions`,
  `get_session_summary`, `get_session_console_errors`,
  `get_session_network_errors`, `get_user_action_before_error`,
  `get_dom_snapshot`, `query_dom_history`, `generate_playwright_repro`,
  `request_authorization`, `execute_action`), the standard workflow shape
  (start with `list_recent_sessions`, drill in by `sessionId`), the
  five-level per-origin permission model + the destructive-action consent
  flow, and three worked examples (500-error investigation, Playwright test
  generation, live-browser action with consent).

  Implementation:
  - `packages/peek-cli/skills/peek-skill.md` — the canonical skill content
    (~6 KB). `scripts/postbuild.mjs` copies it into `dist/skills/` so the
    installed npm tarball can read it relative to the running JS.
  - `packages/peek-cli/src/lib/claude-skill.ts` — pure `installSkill()`
    function with injected IO (`fileExists` / `readFile` / `writeFile` /
    `mkdir`) so the behavior is testable without touching the real
    filesystem. Returns one of five outcomes: `wrote` / `updated` /
    `unchanged` (idempotent — re-running over a byte-identical file is a
    no-op) / `source_missing` / `error`.
  - `packages/peek-cli/src/commands/init.ts` — wires the skill install
    between `configureClients` and `registerNativeHost`. Only fires when
    Claude Code is in the chosen client set OR `~/.claude.json` already
    exists (don't write a skill for a tool the user doesn't have). New
    `--skip-skill` flag.
  - `packages/peek-cli/test/claude-skill.test.ts` — 8 unit tests covering
    the five outcomes, fresh install, idempotent re-run, stale-content
    refresh, source-missing, write-failure, and unreadable-but-overwritable
    existing file.
  - `packages/peek-cli/README.md` — new "Claude Code skill" subsection.
  - `docs/peek/distribution/claude-code-skill.md` — standalone curl-able
    recipe for users who want the skill without running `peek init`.

  `pnpm --filter @peekdev/cli test`: 141 tests pass (was 133; +8 new).

  Per launch plan §3.2, this is the Week 2 peek ship.

## 0.1.0-alpha.11

### Patch Changes

- @peekdev/mcp@0.1.0-alpha.7

## 0.1.0-alpha.10

### Patch Changes

- @peekdev/mcp@0.1.0-alpha.6

## 0.1.0-alpha.9

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
  - @peekdev/mcp@0.1.0-alpha.5

## 0.1.0-alpha.8

### Patch Changes

- 0437b0a: Fix `peek sessions list --json` field shape: now emits `console_count` +
  `network_count` per row as the original P-18 spec called for. Uses a
  single SQL aggregation (correlated subqueries leveraging the existing
  `(session_id, ...)` indexes on `console_events` + `network_events`) — no
  N+1 queries on the list path. Definitions match `getSessionCounts`
  exactly (console errors = level='error'; network errors = status >= 400
  OR error_text non-null) so JSON list + `peek sessions show <id>` agree.

  Alpha.7 shipped the wrong shape (was emitting `bytes` + `status` instead
  of the spec'd counts). Both fields are still emitted alongside the
  counts since they're already in the row and useful for triage — strict
  spec required the counts, didn't prohibit the extras.

## 0.1.0-alpha.7

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

- Updated dependencies [15e4f8c]
  - @peekdev/mcp@0.1.0-alpha.4

## 0.1.0-alpha.6

### Patch Changes

- Phase 5 self-marketing artifacts (indirect virality pattern per
  Loom/Calendly/Statuspage research):
  - @tracelane/report: HTML reports now carry a non-intrusive footer
    attributing back to the GitHub repo's @tracelane/wdio package, with
    UTM-tagged links for indirect-virality attribution. Every report
    shared in a PR or attached to a JIRA ticket becomes a tracked
    acquisition channel.
  - @peekdev/cli: `peek sessions export` (JSON + Markdown) now includes
    an `_attribution` block crediting peek and linking back to the repo
    with format-specific UTM tags. Stays out of the session payload
    (`_` prefix convention).

  Both link to the npm install path (per the research's "link to install
  command, not marketing site" rule). Removable on future paid tiers
  (none exist today).

## 0.1.0-alpha.5

### Patch Changes

- Phase 4c QA loop #4 — both 🔴 showstoppers from the maintainer's alpha.4 walk:
  - **P-16** — `peek init` now writes a tiny shell wrapper at
    `~/.peek/peek-mcp-host.sh` (`.cmd` on Windows) that hardcodes
    `process.execPath` and points the native-host manifest at the wrapper
    instead of the raw `dist/index.js`. Chrome spawns the manifest's `path`
    via the GUI launcher's `$PATH` (not the shell's); on macOS with both a
    legacy `/usr/local/bin/node` (x86_64 v14) and current
    `/opt/homebrew/bin/node` (arm64), the system PATH resolves
    `#!/usr/bin/env node` to the older binary, which dlopen-fails on
    arm64-compiled `better-sqlite3.node` and crashes the host before Chrome
    reads any output. Standard pattern for Node-based native messaging hosts.
  - **K.4** — `peek sessions delete <id>` now also removes the per-session
    chunk directory under `~/.peek/rrweb-events/<id>/`. Pre-fix, the DB row
    was dropped (and child rows cascaded via SQLite ON DELETE CASCADE) but
    the gzipped chunks lingered on disk forever. `peek sessions delete
--all-older-than <dur>` got the same cascade — SELECT-ids inside a
    transaction so the FS cleanup matches whatever the DB actually removed,
    even under concurrent writes.

  peek-cli only — no other packages affected. peek-mcp / tracelane-\* stay at
  alpha.3; peek-extension stays at alpha.2.

## 0.1.0-alpha.4

### Patch Changes

- Phase 4c QA loop #3 — two targeted fixes from the maintainer's alpha.3 walk:
  - **P-13** (`@peekdev/cli`): `peek init` is now idempotent. Before prompting
    for the unpacked extension ID, it reads the first existing native-host
    manifest's `allowed_origins`, extracts any previously-saved dev ID via the
    new `extractDevId()` helper, and offers to reuse it. Decline falls through
    to the original prompt. Confirms B.4 idempotency of the Phase 4c QA
    checklist.
  - **P-14** (`@peekdev/extension`): the `debugger` permission moved from
    `optional_permissions` to required `permissions`. Chrome 121+ banned
    `debugger` from MV3 optional permissions; the entry was silently dropped
    at load, breaking Deep capture (Group H) at install. The install card now
    shows the read-and-modify-all-data warning; per-origin Deep capture
    control via the side-panel toggle (ADR-0010) is unchanged.

  `@peekdev/extension` stays `private: true` — the manifest fix ships only to
  maintainers who rebuild locally and load unpacked. CWS submission remains
  Phase 5.

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
  - @peekdev/mcp@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Phase 4c QA fixes — republishes to address 3 install-blockers + 2 polish bugs found during manual QA:
  - **`workspace:*` not replaced in published deps** (all 5 packages) — the alpha.1 bootstrap used `npm publish` from each package directory, which doesn't resolve pnpm's workspace protocol. Fresh `pnpm install` / `npm install` of any of these alpha.1 packages fails with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` / `ERR_EUNSUPPORTEDPROTOCOL`. Alpha.2 ships via CI's `pnpm release` path which `changeset publish`-rewrites the protocol to a real version range before uploading.
  - **`@peekdev/cli` + `@peekdev/mcp` `invokedDirectly` guard** silently exits under pnpm's virtual store. `process.argv[1]` comes from the shallow `node_modules/<scope>/<pkg>/dist/index.js` shim path while `import.meta.url` resolves through the deep `.pnpm/…` symlink — they never compare equal, so the CLI runs but produces no output. Adds a `realpathSync` fallback.
  - **`@peekdev/mcp` `files` field** was missing `scripts/postinstall-guard.mjs` — the postinstall referenced it, so fresh installs hit `MODULE_NOT_FOUND`. Added.
  - **`@peekdev/mcp` `serverInfo.version`** was hardcoded to `0.1.0-alpha.0` and drifted; now read from `package.json` at runtime via `createRequire`. A scaffold regression test pins them together.
  - **`@tracelane/wdio` `TraceLaneService` constructor type** widened from `TraceLaneOptions` to `TraceLaneOptions & WebdriverIO.ServiceOption` so consumers' `wdio.conf.ts` typechecks without `// @ts-expect-error`.

- Updated dependencies
  - @peekdev/mcp@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- @peekdev/mcp@0.1.0-alpha.1
