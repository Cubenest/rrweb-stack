---
"@tracelane/report": minor
"@tracelane/core": patch
"@tracelane/wdio": patch
"@tracelane/cli": patch
---

Revamp the @tracelane/report HTML report UI — "Editorial Postmortem"
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
