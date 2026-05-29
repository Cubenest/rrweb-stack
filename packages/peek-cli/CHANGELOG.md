# @peekdev/cli

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
