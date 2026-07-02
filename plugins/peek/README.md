# peek — Claude Code plugin

Let your AI coding agent debug what already happened in your real browser.

This plugin bundles two things:

- the **peek MCP server** (`@peekdev/mcp`, run via `npx -y @peekdev/mcp@latest`) — 17 read/act tools over your locally-recorded browser sessions
- the **peek skill** — guidance that tells the agent when and how to reach for those tools

## Install

From this repo's marketplace:

```
/plugin marketplace add Cubenest/rrweb-stack
/plugin install peek@peek
```

Or install it from a community Claude Code plugin marketplace once listed.

## You still need the recorder

This plugin ships the MCP server + skill. The other half of peek — the Chrome
extension that records your sessions, and the local native host that owns
`~/.peek/sessions.db` — is installed separately:

```
npx @peekdev/cli init
```

and the **peek** extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb). Until a session has been captured, the tools return empty results.

## Privacy

Local-first: peek uploads nothing — what your MCP client does with the data is up to you. The recording lives in `~/.peek`; the MCP server reads it locally over stdio. No telemetry, no account, no cloud.

## Maintenance

`version` in `.claude-plugin/plugin.json` is pinned; bump it on plugin-*structure* changes. The MCP server tracks `@latest`, so new peek tools reach users without a plugin bump. Apache-2.0.
