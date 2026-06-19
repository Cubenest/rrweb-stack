# @cubenest/rrweb-core

## 0.1.0-alpha.7

### Patch Changes

- 69cd9c1: docs: normalize README badge rows across all published packages.

  Two published packages (`@tracelane/core`, `@tracelane/report`) and the shared
  `@cubenest/rrweb-core` had no badges at all; OpenSSF Scorecard was applied
  unevenly (missing from playwright, peek-cli, peek-mcp); and no package carried
  the accurate `types` / `node` engine badges despite all shipping `.d.ts` and
  declaring `engines.node >=22`.

  Every README now leads with a consistent, verified badge row — version,
  downloads, license, CI, OpenSSF Scorecard, then `types` (libraries only — not
  the bin-only CLIs), `node`, and a static `alpha` status badge. All badge
  endpoints were verified to resolve against the published `latest` dist-tag.
  Docs-only; no code change.

- db8d39b: docs: non-badge README fixes from the public-doc audit.

  Accuracy: rescope the `@tracelane/wdio` tagline to WebdriverIO only (Playwright
  is the separate `@tracelane/playwright` package); replace the verbatim consumer
  tagline copied onto `@tracelane/core` and `@tracelane/report` with
  engine/builder-specific one-liners; drop the inapplicable "WDIO 8" CDP
  instruction (peerDep is `webdriverio ^9`); de-duplicate a garbled sentence in
  the `@tracelane/cli` config-edit section; fix a Cursor-docs link whose text and
  href host diverged.

  npm rendering: convert relative `NOTICE`/`COMPATIBILITY`/CWS links to absolute
  GitHub URLs so they resolve on npmjs.com; replace placeholder Chrome-Web-Store
  links with an honest "listing pending (Phase 5)" note.

  Completeness: add per-package CHANGELOG links, threat-model (SECURITY-NOTES /
  peek THREATMODEL) links, a `report.footer` Options row + Node ≥ 22 prose for
  wdio, an Install section for `@tracelane/report`, "Related packages" cross-link
  lists, a minimal API pointer for the engine packages, and a brand logo +
  "What it detects" / distribution note for `@tracelane/security`.

  Also tightens the `@tracelane/cli` and `@tracelane/playwright` package.json
  descriptions (npm sidebar) for accuracy. Docs/metadata only; no code change.

## 0.1.0-alpha.6

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

## 0.1.0-alpha.5

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

## 0.1.0-alpha.4

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

## 0.1.0-alpha.3

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

## 0.1.0-alpha.2

### Minor Changes

- 7100b3f: feat(rrweb-core): framework-agnostic network capture plugin.

  Adds `getRecordNetworkPlugin(options?)` adapted from PostHog's
  Apache-2.0 network-plugin.ts (NOTICE attribution added). Emits
  EventType.Plugin events with name 'rrweb/network@1' from a
  recorder running anywhere — in-browser extension, WDIO Service,
  future Playwright/Cypress reporters. Wraps fetch + XHR +
  PerformanceObserver. Bodies + headers default OFF; opt-in via
  options. Masking pipes through the existing redactBody +
  redactNetworkHeaders helpers.

  Consumer integration ships separately in subsequent commits
  (tracelane-wdio recorder bundle, peek-extension recorder, and
  tracelane-report panel extraction).

## 0.1.0-alpha.1

### Patch Changes

- Fix: relative imports now carry `.js` extensions so the package resolves cleanly under bare Node / NodeNext ESM. The previous `0.1.0-alpha.0` shipped with extensionless imports and would fail at runtime when consumed by NodeNext downstream packages.
