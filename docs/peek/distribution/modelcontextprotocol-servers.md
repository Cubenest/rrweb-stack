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
- **Package-ownership verification:** the registry validates that the
  publisher controls the npm package referenced in `server.json`. Since
  `@peekdev/mcp` is published from the Cubenest org via OIDC (Phase 5 Gate
  B), this is already in place.
- **Restricted registry base URLs:** only public npm
  (`https://registry.npmjs.org`) — peek meets that requirement.

## Pre-filled server.json for peek

The fields below are draft. Run `mcp-publisher init` in
`packages/peek-mcp/` at submission time — it autodetects `package.json`
and pre-fills most of this. Reconcile against the live schema URL
(`https://static.modelcontextprotocol.io/schemas/<latest>/server.schema.json`)
before submitting.

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.cubenest/peek-mcp",
  "title": "peek",
  "description": "Local-first MCP server that exposes recorded browser sessions (rrweb DOM + console + network) to AI coding agents. Companion Chrome MV3 extension captures sessions to a local SQLite database; no cloud, no telemetry.",
  "version": "0.1.0-alpha.7",
  "websiteUrl": "https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp",
  "repository": {
    "url": "https://github.com/Cubenest/rrweb-stack",
    "source": "github",
    "subfolder": "packages/peek-mcp"
  },
  "packages": [
    {
      "registryType": "npm",
      "registryBaseUrl": "https://registry.npmjs.org",
      "identifier": "@peekdev/mcp",
      "version": "0.1.0-alpha.7",
      "transport": {
        "type": "stdio"
      },
      "runtimeHint": "npx"
    }
  ]
}
```

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

1. **Install the publisher:**
   ```sh
   brew install mcp-publisher
   ```
2. **Authenticate (one-time, interactive):**
   ```sh
   mcp-publisher login github
   ```
   This grants publish rights to `io.github.cubenest/*`.
3. **Run from `packages/peek-mcp/`:**
   ```sh
   cd packages/peek-mcp
   mcp-publisher init           # generates a starter server.json from package.json
   # Hand-edit to match the example above (description, transport, websiteUrl).
   mcp-publisher publish        # uploads to registry.modelcontextprotocol.io
   ```
4. **Verify the listing:**
   ```sh
   curl https://registry.modelcontextprotocol.io/v0/servers?name=io.github.cubenest/peek-mcp
   ```
   PulseMCP ingests from the official registry daily (see `pulsemcp.json`
   notes), so a successful publish here also feeds downstream registries.

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
