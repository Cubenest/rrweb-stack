# modelcontextprotocol — peek entry (DRAFT)

**Status: DRAFT — DO NOT SUBMIT until Phase 5 launch.**

> Schema audit performed 2026-05-30. The submission target documented in the
> earlier draft of this file (a PR to a "Community Servers" list inside the
> [`modelcontextprotocol/servers`](https://github.com/modelcontextprotocol/servers)
> README) **no longer exists.** Anthropic refactored the README and now
> directs all third-party server discovery to the official **MCP Registry**
> at `https://registry.modelcontextprotocol.io/`. The `modelcontextprotocol/servers`
> README currently only carries: (1) reference servers maintained by the MCP
> steering group, (2) SDK frameworks, and (3) "Resources" (other registries /
> indexes / curation tools). peek is none of those three — it is a server.
>
> The correct 2026 submission path is therefore the official MCP Registry
> via the `mcp-publisher` CLI + a `server.json` file. The rest of this
> document describes that flow.

## Submission target: official MCP Registry

- **Registry URL:** `https://registry.modelcontextprotocol.io/`
- **Tool:** `mcp-publisher` CLI (`brew install mcp-publisher`)
- **Spec:** [`server.json` schema](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)
- **Official-registry requirements:** [`official-registry-requirements.md`](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md)
- **Auth:** GitHub OAuth (interactive) or GitHub OIDC (CI). The publisher
  must own the namespace. To publish under `io.github.cubenest/peek-mcp`,
  the maintainer authenticates as a member of the `Cubenest` GitHub org.
- **Package-ownership verification:** the registry downloads the published
  `@peekdev/mcp` at the exact `server.json` version and requires its
  `package.json` to carry `"mcpName": "io.github.cubenest/peek-mcp"` (confirmed
  against `internal/validators/registries/npm.go`, 2026-06-02 — it does
  `if npmResp.MCPName != serverName { reject }`). This is **NOT** satisfied by
  OIDC provenance alone — the field must ship *in the package*. It has been added
  to `packages/peek-mcp/package.json`; it goes live with the next release
  (expected `0.1.0-alpha.13`). Until that version is on npm, `publish` fails with
  *"NPM package … is missing required 'mcpName' field"*.
- **Restricted registry base URLs:** only public npm
  (`https://registry.npmjs.org`) — peek meets that requirement.

## server.json for peek (canonical file committed)

The validated `server.json` is committed at
[`packages/peek-mcp/server.json`](../../../packages/peek-mcp/server.json) — edit it
*there*, not here. It targets schema `2025-12-11`, name `io.github.cubenest/peek-mcp`,
title `peek`, transport `stdio`, runtimeHint `npx`, package `@peekdev/mcp`.

Two constraints that bit the earlier draft (verified against the live schema,
2026-06-02):

- **`description` is capped at 100 characters** (`maxLength: 100`). The earlier
  ~230-char marketing description would have been rejected; the committed file uses
  a terse 96-char line.
- **`version` must equal a *published* `@peekdev/mcp` version that carries the
  `mcpName` field** (see ownership note above). The committed file pins
  `0.1.0-alpha.13` (the next release, which adds `mcpName`); reconcile if the bump
  differs. `version` must be a concrete version — no ranges, no `latest`.

### Tool list (informational — not part of `server.json`)

For listings that surface tool counts, peek exposes 10 MCP tools:

- `list_recent_sessions`
- `get_session_summary`
- `get_session_console_errors`
- `get_session_network_errors`
- `get_user_action_before_error`
- `generate_playwright_repro`
- `get_dom_snapshot`
- `query_dom_history`
- `request_authorization`
- `execute_action`

## Submission checklist

1. **Publish the `mcpName` release FIRST.** `mcpName` is already in
   `packages/peek-mcp/package.json` and a changeset is staged; cut the release so
   `@peekdev/mcp@0.1.0-alpha.13` (or whatever the bump yields) lands on npm, then
   verify the field made it into the published package:
   ```sh
   npm view @peekdev/mcp@0.1.0-alpha.13 mcpName   # → io.github.cubenest/peek-mcp
   ```
   Confirm `packages/peek-mcp/server.json`'s `version` equals that published version.
2. **Install the publisher** (one of):
   ```sh
   brew install mcp-publisher
   # or, for CI / no-brew:
   curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
   ```
3. **Authenticate** (must be a `Cubenest` org member to claim `io.github.cubenest/*`):
   ```sh
   mcp-publisher login github          # interactive
   # or in GitHub Actions (needs `permissions: id-token: write`):
   ./mcp-publisher login github-oidc
   ```
4. **Publish from `packages/peek-mcp/`** (server.json is already committed — no `init`):
   ```sh
   cd packages/peek-mcp
   mcp-publisher publish               # reads ./server.json
   ```
5. **Verify the listing:**
   ```sh
   curl "https://registry.modelcontextprotocol.io/v0/servers?name=io.github.cubenest/peek-mcp"
   ```
6. **Then submit the downstream registries SEPARATELY.** They do **NOT** auto-ingest
   from the official registry (verified 2026-06-02 — the earlier "feeds downstream
   registries" note was wrong). PulseMCP auto-scrapes *npm* (not the official
   registry) plus a manual form; Smithery and mcp.so each need their own submission.
   See [`README.md`](./README.md).

## Optional: keep a one-line entry in `modelcontextprotocol/servers` Resources

The "Resources" section of `modelcontextprotocol/servers/README.md` does
accept third-party links to **discovery surfaces** (registries, indexes,
curation tools — see PulseMCP / Smithery / mcp.so entries already in it).
peek does NOT belong here — it's a server, not a registry. **Do not
submit a PR to that README.** The registry listing is sufficient.

## TODO_AFTER_CWS

The Chrome Web Store URL for the companion extension can be referenced in
the `description` once the listing is live. Until then, the description
above stays clear of CWS-link claims to keep the listing accurate.

## Maintainer notes

- The previous draft of this file pre-supposed an alphabetical PR into a
  "Community Servers" list. That list was retired during the December 2025
  registry migration. Don't waste a PR there.
- `mcp-publisher` reads `package.json` next to it; running from
  `packages/peek-mcp/` is the supported invocation site.
- The MCP Registry caps the `_meta.io.modelcontextprotocol.registry/publisher-provided`
  block at 4 KB. peek's server.json has no `_meta` block yet, so this is
  not a constraint at submission time.
