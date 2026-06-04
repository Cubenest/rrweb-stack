---
---

Add a live demo report for `@tracelane/playwright` (docs + maintainer tooling only — no package release).

- New `demo/` fixtures + a loopback server that returns a real 404 and 500, and a
  `scripts/gen-demo-report.mjs` generator (`pnpm --filter @tracelane/playwright demo:gen`)
  that produces ONE real report from a two-page checkout failure exercising the alpha.2
  navigation fix (rrweb replay continuing across `products → checkout`).
- The generator redacts every machine-specific string from BOTH the plaintext HTML and
  the gzipped event blob (decode → redact → re-encode), then runs a dual-surface
  leak-guard, and writes the artifact to the docs site at
  `/demo/playwright-checkout-failure.html`. The `/demo` page and the two Playwright
  recipes now link it via the `artifact:` field.

No version bump: the generator and `demo/` fixtures are excluded from the npm tarball
(`files`), the published `dist` is unchanged, and the artifact ships via the docs site,
not npm.
