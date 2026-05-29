---
"@tracelane/cli": patch
"@tracelane/wdio": patch
---

**Fix shipped READMEs: `npx tracelane init` 404'd because npx's auto-install
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
