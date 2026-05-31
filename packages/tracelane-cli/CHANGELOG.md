# @tracelane/cli

## 0.1.0-alpha.7

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

## 0.1.0-alpha.6

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

## 0.1.0-alpha.5

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

## 0.1.0-alpha.4

### Patch Changes

- fd94184: Embed the `tracelane-hero.gif` (the `npx @tracelane/cli init` flow against
  a real WebdriverIO project) at the top of the npm landing page so visitors
  arriving on https://www.npmjs.com/package/@tracelane/cli see the wedge-
  amplifier UX, not just the install code block. Same asset that
  @tracelane/wdio already ships; ref'd via the absolute
  raw.githubusercontent.com URL so the package tarball stays small.

## 0.1.0-alpha.3

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

## 0.1.0-alpha.2

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

## 0.1.0-alpha.1

### Minor Changes

- 2d46f59: Initial release of `@tracelane/cli` (Phase 5 wedge amplifier per
  the launch plan): one-command scaffolding for adding tracelane to a
  WebdriverIO project.

  `npx tracelane init` detects the test runner from `wdio.conf.{ts,js,mjs,cjs}`,
  the package manager from lockfile presence (pnpm > yarn > npm > bun, npm
  fallback), runs the dev-add, edits the conf in place to import + register
  `TraceLaneService`, creates `./tracelane-reports/`, and appends to
  `.gitignore`. Idempotent re-runs are a no-op. The conf editor backs out
  cleanly on unrecognised shapes (prints a manual-paste snippet, rest of
  init still runs) — never corrupts the user's file.

  Playwright and Cypress detection works but the v0.1 CLI prints a
  "coming Q3/Q4 2026" message and exits 0; integration packages are
  tracked in issues #11 + #12.

  Flags: `--runner <name>`, `--dry-run`, `--yes`/`-y`, `--skip-install`,
  `--help`/`-h`. Zero runtime dependencies — pure node:\* primitives.

  This is the published-path lever from the integration-led-distribution
  research: replaces the previous `npm install + manual wdio.conf.ts edit`
  two-step with a single npx invocation. Drives all README install
  instructions across the launch.
