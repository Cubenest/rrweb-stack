# mcp.so — peek submission (DRAFT)

**Status: DRAFT — DO NOT SUBMIT until Phase 5 launch.**

> Schema audit performed 2026-05-30. The earlier draft of this file
> assumed mcp.so accepted markdown-file PRs into the
> [`chatmcp/mcp-directory`](https://github.com/chatmcp/mcp-directory) repo.
> That assumption was wrong. The repo is a Next.js + Supabase web app — its
> live data lives in a Supabase database, not in markdown files in the
> repo. There is no `servers/` directory of markdown PRs to merge.
>
> The actual submission path is the **mcp.so website UI** (free-text form
> backed by Supabase). The `submit` page at <https://mcp.so/submit>
> returned a 403 to anonymous probes from this audit; the form is likely
> behind a login or Cloudflare anti-bot. The maintainer should visit
> the site interactively at submission time.
>
> Below: the source content (description + metadata) to paste into
> whichever fields the mcp.so form prompts for.

---

## Source content (paste into the mcp.so submission form)

### Name
peek

### One-line tagline
Bring your real authenticated browser session to AI coding agents. Local-first MCP server + Chrome MV3 extension. No cloud. No telemetry.

### Links
- **NPM:** `@peekdev/mcp` — https://www.npmjs.com/package/@peekdev/mcp
- **Repo:** https://github.com/Cubenest/rrweb-stack
- **Subfolder:** https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp
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
database via 14 MCP tools:

| Tool | What it does |
|---|---|
| `list_recent_sessions` | List recently recorded sessions (id, origin, ts, event count). |
| `get_session_summary` | LLM-readable narrative summary of a session. |
| `get_session_console_errors` | Console errors recorded in a session. |
| `get_session_network_errors` | Failed/notable network requests in a session. |
| `get_user_action_before_error` | Last N user actions before a console error. |
| `generate_playwright_repro` | Generate a runnable Playwright test from a session. |
| `get_dom_snapshot` | Reconstruct the DOM at a given timestamp. |
| `query_dom_history` | Timeline of attribute/text changes for a selector. |
| `request_authorization` | Side-panel consent for write actions (Level 3). |
| `execute_action` | Dispatch a UI action (gated by permission level + destructive blocklist). |
| `suggest_element` | Highlight an element via a non-destructive overlay (Level 2+). |
| `clear_highlight` | Remove the highlight overlay (Level 2+). |
| `set_intent` | Set the control-shield status banner (Level 4). |
| `request_user_input` | Pause and hand a field back to the user, then resume (Level 4). |

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
# (link added once the CWS listing is approved)
```

### Tags

`browser` `rrweb` `session-recording` `chrome-extension` `local-first`
`privacy` `session-replay` `mcp` `developer-tools` `browser-automation`

---

## Submission process notes (2026-05-30)

- **Where to submit:** https://mcp.so/submit — the form is behind
  login / Cloudflare; visit interactively. If that page no longer exists
  at submission time, mcp.so also has a Telegram + Discord linked from
  the [`chatmcp/mcp-directory`](https://github.com/chatmcp/mcp-directory)
  README — use those to ping the maintainer (handle: `idoubi`).
- **Backend:** Supabase. The site reads its server listings from a DB; new
  entries appear after the maintainer accepts the submission.
- **Lead time:** ~1 day typical, occasionally longer if the maintainer
  is offline.

## TODO_AFTER_CWS

- [ ] Replace the "Chrome extension" install line with the actual Chrome
      Web Store URL once the CWS listing is live.

## TODO_VERIFY

- [ ] If https://mcp.so/submit still 403s at submission time, the form
      may have moved. Check the mcp.so homepage for a "Submit Server"
      link before falling back to the Telegram/Discord channels.
- [ ] mcp.so may now require a screenshot or hero image — flag to the
      maintainer that the alpha UI screenshots from Phase 4 should be
      ready to upload.
- [ ] Confirm the categories enum on the live submission form — if
      "Developer Tools / Browser Automation" is no longer offered, fall
      back to the closest available category.
