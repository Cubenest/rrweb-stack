# peek — cursor.directory submission (DRAFT)

**Status: DRAFT — DO NOT SUBMIT until Phase 5 launch.**

[cursor.directory](https://cursor.directory) is the curated discovery surface
for Cursor plugins (rules, MCP servers, skills, agents, hooks, LSP servers).
Since the 2026 migration to [`cursor/community-plugins`](https://github.com/cursor/community-plugins)
(formerly `pontusab/cursor.directory`) **submission is no longer a PR** — it
runs through the website form and the directory auto-detects components from
the submitted GitHub repo. The README of the new repo is explicit: "All
content is submitted through the website — no pull requests needed for data."

## Mechanism

cursor.directory's auto-detector scans the submitted repo for these paths
([Open Plugins](https://open-plugins.com/plugin-builders/specification)
specification):

| Component | Auto-detected at |
|---|---|
| Rules | `rules/*.mdc` |
| MCP Servers | `.mcp.json` |
| Skills | `skills/*/SKILL.md` |
| Agents | `agents/*.md` |
| Hooks | `hooks/hooks.json` |
| LSP Servers | `.lsp.json` |

For peek's submission we only need the MCP-server row. The artifact is
**one file at the repo root**: `.mcp.json` (note the leading dot — the
no-dot `mcp.json` form is used only inside multi-plugin folders under
`plugins/*/mcp.json`, per the [plugin template](https://github.com/cursor/plugin-template/blob/main/docs/add-a-plugin.md)).

## Artifact to ship: `.mcp.json` at repo root

Drop this into the root of [`Cubenest/rrweb-stack`](https://github.com/Cubenest/rrweb-stack)
before submitting:

```json
{
  "mcpServers": {
    "peek": {
      "command": "npx",
      "args": ["-y", "@peekdev/mcp"]
    }
  }
}
```

This matches the block `peek init` writes to every supported client
(`packages/peek-cli/src/lib/init-config.ts` → `PEEK_MCP_BLOCK`) so users who
install peek through cursor.directory get exactly what the CLI would have
configured.

The Open Plugins schema also accepts `env` and `cwd` per server; peek does
not require either at the MCP-config layer (the native host owns
`~/.peek/sessions.db` paths via `@peekdev/mcp/db`, and the extension's
allowed origin is read from `extension-ids.json` inside the published
package).

## Submission steps

1. **Land `.mcp.json` on `main`.** One commit at the repo root with the JSON
   above. DCO sign-off (`git commit -s`). No other files needed — the
   directory does not read `plugin.json` for single-plugin repos that only
   ship an MCP server.
2. **Open [cursor.directory/plugins/new](https://cursor.directory/plugins/new).**
   Sign in with GitHub (the same account that owns or has push to
   `Cubenest/rrweb-stack`).
3. **Paste the repo URL:** `https://github.com/Cubenest/rrweb-stack`.
4. **Submit.** The Cursor SDK agent (`composer-2`, per the
   community-plugins README) auto-scans the repo for safety, marks it
   `safe` / `suspicious` / `malicious`, and queues it for indexing. Verdict
   typically arrives within a few minutes; the listing appears once the
   scan returns `safe`.

There is no PR to review, no maintainer to ping. If the scan flags peek
incorrectly, the recovery path is the contact link on cursor.directory
(GitHub issues on `cursor/community-plugins` are open — `has_issues: true`
per the repo metadata).

## Listing metadata (what cursor.directory will display)

cursor.directory pulls display metadata from the repo itself:

| Field | Source on `Cubenest/rrweb-stack` |
|---|---|
| Name | Repo name (`rrweb-stack`) — overridden by the MCP server key (`peek`) in `.mcp.json` |
| Description | Repo description on GitHub (currently the project description) |
| README | Auto-rendered from `README.md` at root |
| License | Detected from `LICENSE` (Apache-2.0) |
| Repo URL | Submission URL |
| Categories | Inferred by the indexer; not author-provided |
| Install command | Derived from `.mcp.json` (`npx -y @peekdev/mcp`) |

There is no opportunity to provide a separate display name, screenshots,
or category tags through the form — the directory's content model is
"the repo is the source of truth." This is why the artifact (`.mcp.json`)
matters more than any submission copy.

## Pre-submission checklist

- [ ] `Cubenest/rrweb-stack` is public (the auto-scanner requires repo
      clone access; private repos cannot be indexed).
- [ ] `.mcp.json` lives at the repo root and parses as valid JSON.
- [ ] The MCP server key inside `.mcp.json` is `peek` (lowercase, no
      dashes — this is what Cursor displays as the server name).
- [ ] `@peekdev/mcp` is published on npm at a non-prerelease tag that
      `npx -y` will resolve by default. (Pre-release alpha tags like
      `0.1.0-alpha.x` are resolved by `npx -y` only with an explicit
      version — confirm `npm view @peekdev/mcp dist-tags.latest` returns a
      version before submitting, or pin in `.mcp.json` with
      `["-y", "@peekdev/mcp@<version>"]`.)
- [ ] Repo description on GitHub reads naturally as the directory
      listing's tagline.
- [ ] README hero block + install instructions land cleanly when
      rendered standalone on cursor.directory.
- [ ] The Chrome Web Store listing is live, or the README clearly states
      the extension companion's install path. cursor.directory users may
      install peek's MCP via the JSON snippet without the extension, in
      which case they will see zero sessions until the extension is
      installed and recording — make the dependency explicit.

## TODO before submitting

- [ ] Verify the auto-detector's current behavior — the
      `cursor/community-plugins` repo updates fairly often, and the
      auto-scan model (`composer-2`) may change. Cross-check the
      [README](https://github.com/cursor/community-plugins/blob/main/README.md)
      auto-detected components table at submission time.
- [ ] Confirm the npm `latest` dist-tag has shipped (per the checklist
      above). Pin to a version in `.mcp.json` if `latest` is still on the
      alpha track.
- [ ] Re-read `Cubenest/rrweb-stack`'s GitHub description and README hero
      block — these become the listing's user-facing copy.
- [ ] Decide whether to also ship `rules/*.mdc` and `skills/peek/SKILL.md`
      via the same repo (the skill already exists at
      `packages/peek-cli/skills/peek-skill.md` but is not at the
      auto-detected path `skills/peek/SKILL.md`). Trade-off: surfacing
      both Components increases discoverability but commits us to keeping
      them rendered well in cursor.directory's listing — defer past the
      first MCP-only submission.
