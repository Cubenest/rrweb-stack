# @tracelane/cli

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
