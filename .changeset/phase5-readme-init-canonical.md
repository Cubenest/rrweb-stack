---
"@tracelane/wdio": patch
"@tracelane/cli": patch
---

Phase 5 wedge amplifier wiring: lead READMEs with `npx tracelane init` as the
canonical install path, per the launch plan §4.6 ("Every README must lead with
the install command, get it short, get it right, get it above the fold").

- `@tracelane/wdio`: top-of-README now shows `cd your-wdio-project && npx tracelane init`
  as the one-line install. The previous manual `npm install --save-dev @tracelane/wdio`
  + hand-edited conf snippet is preserved under "Or wire it manually" for users who
  want to know what's happening (and for CI scripts that can't run an interactive prompt).
- `@tracelane/cli`: brand-continuity touch — the broader product tagline now leads
  the README above the CLI-specific tagline, so npm searches landing on this
  package immediately see the tracelane family identity.
- Root `README.md` (not bumped — repo file, not a package): the product table's
  tracelane install column updated to `npx tracelane init`.

Also exercises the new `@tracelane/cli` Trusted Publisher configured 2026-05-29
after the bootstrap publish — if this OIDC release succeeds, future CI publishes
need no manual intervention.
