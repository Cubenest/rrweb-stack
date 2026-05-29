# @tracelane/cli

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
