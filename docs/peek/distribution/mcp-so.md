# mcp.so — peek submission (DRAFT)

**Status: DRAFT — DO NOT SUBMIT until Phase 5 launch.**

mcp.so's submission is a markdown blurb. The maintainers typically curate
entries from the source content below; if they have a PR-style submission
process at submission time, this same markdown serves as the PR body.

---

## peek

**Bring your real authenticated browser session to AI coding agents.**
Local-first MCP server + Chrome MV3 extension. No cloud. No telemetry.

- **NPM:** [`@peekdev/mcp`](https://www.npmjs.com/package/@peekdev/mcp)
- **Repo:** https://github.com/Cubenest/rrweb-stack
- **License:** Apache-2.0
- **Language:** TypeScript
- **Transport:** stdio
- **Category:** Developer Tools / Browser Automation

### What it does

peek records the user's actual logged-in browser (DOM via rrweb, console
events, network metadata, optional response bodies via opt-in Deep capture)
through a Chrome MV3 extension. The extension ships events through a
native-messaging stdio bridge to a local MCP server (`peek-mcp`), which
persists them to a SQLite database at `~/.peek/sessions.db`. AI coding
agents (Claude Code, Cursor, Cline, Windsurf) read sessions from the
database via four MCP tools:

| Tool | What it does |
|---|---|
| `peek_sessions_list` | List recorded sessions (id, origin, ts, event count). |
| `peek_session_get` | Fetch a session's events, console, network. |
| `peek_execute_action` | Dispatch a UI action (gated by permission level + destructive blocklist). |
| `peek_request_authorization` | Side-panel confirmation before sensitive actions. |

### Why local-first matters

Every other "browser session for AI" tool ships to a vendor cloud. peek's
SQLite + extension live on the user's machine — no remote endpoints, no
telemetry. The privacy policy
([`docs/peek/PRIVACY_POLICY.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PRIVACY_POLICY.md))
is the source of truth.

### Install

```sh
# 1. Add the MCP server to Claude Code
claude mcp add peek -- npx -y @peekdev/mcp

# 2. Install the Chrome extension from the Chrome Web Store
# (link added at Phase 5 launch)
```

### Tags

`browser` `rrweb` `session-recording` `chrome-extension` `local-first`
`privacy` `session-replay` `mcp` `developer-tools`

---

## TODO before submitting

- [ ] Confirm the Chrome Web Store URL once the listing is live.
- [ ] Verify mcp.so's current submission format (their site has changed
      layouts in 2025-2026; this markdown is structured to survive most
      reformatting).
- [ ] Add screenshots once the alpha UI freezes (Phase 4).
