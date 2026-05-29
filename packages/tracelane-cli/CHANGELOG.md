# @tracelane/cli

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
