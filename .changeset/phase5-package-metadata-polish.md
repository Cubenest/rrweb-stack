---
"@cubenest/rrweb-core": patch
"@peekdev/cli": patch
"@peekdev/mcp": patch
"@tracelane/cli": patch
"@tracelane/core": patch
"@tracelane/wdio": patch
"@tracelane/report": patch
---

Add `keywords` and `funding` to every published package.json.

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
