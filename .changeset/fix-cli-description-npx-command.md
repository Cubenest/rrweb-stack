---
"@tracelane/cli": patch
---

Fix the npm `description`: `npx tracelane init` → `npx @tracelane/cli init`.

The bare `tracelane` package name 404s on npm (`npx <name>` resolves the literal
registry name; the package is `@tracelane/cli`, whose bin happens to be
`tracelane` — but bin names only work post-install). The READMEs were already
corrected to `npx @tracelane/cli init` by the earlier npx-init fix; the package
`description` (which renders on the npmjs.com package page) was missed. This
republishes the corrected description so the npm landing page matches the
canonical install command.
