---
"@tracelane/wdio": patch
"@tracelane/cli": patch
"@peekdev/cli": patch
"@peekdev/mcp": patch
---

Wire up docs subdomains now that `tracelane.cubenest.in` + `peek.cubenest.in`
are live on Vercel (both returning HTTP/2 200, served via fresh CNAMEs to
`cname.vercel-dns.com`, deployed from the same `Cubenest/rrweb-stack` repo
that publishes these npm packages).

Per-package change is identical and minimal:

- Insert a single `Docs: <hosted-url>` line in the README right below the
  hero GIF / above-the-fold install snippet.
- Update `package.json` `homepage` to point at the deployed docs site
  instead of the GitHub README. The previous recursive
  `github.com/.../tree/main/packages/<name>#readme` value was correct but
  awkward (npm landing page → GitHub README → which then linked back to
  install instructions); now the npm landing page's "homepage" link goes
  straight to the right product's docs.

| Package | Docs URL |
|---|---|
| `@tracelane/wdio` | <https://tracelane.cubenest.in> |
| `@tracelane/cli`  | <https://tracelane.cubenest.in> |
| `@peekdev/cli`    | <https://peek.cubenest.in>      |
| `@peekdev/mcp`    | <https://peek.cubenest.in>      |

Companion (non-published) changes shipped in the same commit:

- Root `README.md` "Docs:" lines updated from relative `apps/*-docs/`
  links to the hosted URLs, with the source-tree path kept in
  parentheses for contributors.
- GitHub repo `homepageUrl` set to `https://cubenest.in` via
  `gh repo edit Cubenest/rrweb-stack --homepage` (the umbrella, not
  one of the two products — both are equally first-class).
- `assets/og-card.png` committed as the canonical social-preview source
  (1200×630, 32 KB, generated from the captured prompt). Repo-level
  GitHub social-preview upload (Settings → Social preview) is a separate
  one-click action by the maintainer — the file is committed so re-uploads
  + re-renders are reproducible.
- `assets/README.md` updated to list `og-card.png` alongside the hero
  GIF assets.

`@cubenest/rrweb-core`, `@tracelane/core`, and `@tracelane/report` are
intentionally NOT in this changeset — their READMEs didn't need
Docs links (they're "internal substrate" packages that disclaim direct
consumption), and their `homepage` fields pointing at the GitHub README
remain appropriate for the shared-substrate framing.
