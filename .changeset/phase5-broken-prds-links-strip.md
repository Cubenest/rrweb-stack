---
"@cubenest/rrweb-core": patch
"@tracelane/core": patch
"@tracelane/wdio": patch
"@tracelane/report": patch
---

Strip broken `prds/*` cross-references from public-facing READMEs. The
`prds/` directory (ADRs + PRDs + IMPLEMENTATION_PLAN) was authored in
the maintainer's parent workspace but was never committed to the public
repo — so every `[ADR-XXXX](prds/adrs/...)` link on the npm landing
pages and the docs site was a 404 for visitors.

Stripped 14 broken references across:
- `packages/tracelane-core/README.md` — 3 ADR refs in "What's in here"
- `packages/tracelane-wdio/README.md` — 3 ADR refs in "What this is NOT"
  + "How it works"
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
(frozen historical records; same rule that applied during the
2026-05-30 audit cleanup at commit 8bc1352-era).
