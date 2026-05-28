# modelcontextprotocol/servers — peek entry (DRAFT)

**Status: DRAFT — DO NOT SUBMIT until Phase 5 launch.**

The [`modelcontextprotocol/servers`](https://github.com/modelcontextprotocol/servers)
repo's `README.md` carries a list of third-party MCP servers under
"Community Servers". Submissions are PRs that add one entry to that list
in alphabetical order.

The current entry format (verify against `README.md` head at submission
time — the README has been refactored at least twice since the registry's
December 2025 move to Linux Foundation AAIF):

```md
- **[peek](https://github.com/Cubenest/rrweb-stack)** — Bring your real
  authenticated browser session to AI coding agents. Local-first MCP server
  + Chrome MV3 extension that records rrweb DOM + console + network into a
  local SQLite database (`~/.peek/sessions.db`). No telemetry, no cloud.
```

## PR description (DRAFT)

```md
Adds **peek** to the Community Servers list.

peek is a local-first MCP server backed by a Chrome MV3 extension. It
records the user's real authenticated browser (DOM via rrweb, console,
network) and exposes the captured sessions to AI coding assistants
(Claude Code, Cursor, Cline, Windsurf) through four MCP tools:
`peek_sessions_list`, `peek_session_get`, `peek_execute_action`,
`peek_request_authorization`.

- **NPM:** `@peekdev/mcp`
- **License:** Apache-2.0
- **Privacy:** all data stays on the user's machine — no remote endpoints,
  no telemetry. Privacy policy:
  https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PRIVACY_POLICY.md
- **Chrome extension:** [Chrome Web Store link — added at launch]
- **Tests:** 256 (extension) + 198 (mcp) green at submission time;
  Playwright persistent-context smoke + WDIO smoke run in CI.

The submission follows the alphabetical ordering convention in the
existing list.
```

## TODO before submitting

- [ ] Re-check the README.md head — the list ordering convention and the
      preferred entry shape may have changed since this draft. Match it
      exactly.
- [ ] Fork the repo and submit the PR from a personal fork (the project
      convention is no direct PRs from the upstream maintainers).
- [ ] Sign the DCO (the modelcontextprotocol org typically requires one
      — confirm at submission time).
- [ ] Add the Chrome Web Store URL once the listing is live.
- [ ] Link to the PulseMCP / Smithery / mcp.so listings as social proof in
      the PR description (assuming they're live first; the distribution
      checklist orders these).
