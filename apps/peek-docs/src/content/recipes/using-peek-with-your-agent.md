---
title: "Using peek with your AI coding agent"
lede: "Once peek is wired into my agent, I want to know when it'll actually help and which of its tools to ask for — without guessing."
description: "A vendor-neutral guide to when to reach for peek and what its MCP tools do — read-path forensics, repro, and consented write tools — for any MCP client."
type: short
status: published
publishedAt: 2026-06-30
integrations: [claude-code, cursor, vscode, windsurf, cline, codex]
relatedRecipes: [set-up-peek-with-claude-code, set-up-peek-with-cursor, set-up-peek-with-vscode]
---

## When to reach for peek

Ask your agent to use peek when you mention:

- "what happened in my last session" / "show my recent sessions"
- "investigate this error" right after you reproduced it
- "what was I doing when X failed" / "what action triggered X"
- "what did the DOM look like when Y happened"
- "turn what I just did into a Playwright test"
- (with consent) "click / fill this on the page open in my browser"

Don't reach for peek for: production/remote data, a live debugger at the current moment (peek replays what was *already captured*), or test-runner failure capture (use the tracelane reporters).

## The tools, by job

peek exposes 16 MCP tools across five tiers.

- **Read — session forensics (no consent needed):** `list_recent_sessions`, `get_session_summary`, `get_session_console_errors`, `get_session_network_errors`, `get_user_action_before_error`, `get_dom_snapshot`, `query_dom_history`, `generate_playwright_repro`.
- **Read — live page (Level 1+, non-mutating):** `get_page_view`, `get_element_detail`.
- **Act — browser actions (Level 3+, consented):** `request_authorization`, `execute_action`.
- **Suggest — non-mutating overlays (Level 2+):** `suggest_element`, `clear_highlight`.
- **Control — supervised assist (Level 4):** `set_intent`, `request_user_input`.

## How it works

peek runs entirely on your machine: a Chrome extension records masked rrweb sessions to a local SQLite store (`~/.peek/sessions.db`); a stdio MCP server exposes the tools above. If `~/.peek/sessions.db` is absent, peek isn't installed — run `npx @peekdev/cli init` first.

## Set peek up for your client

- [Claude Code](/recipes/set-up-peek-with-claude-code) · [Cursor](/recipes/set-up-peek-with-cursor) · [VS Code](/recipes/set-up-peek-with-vscode) · [Cline / Windsurf / Codex](/recipes/set-up-peek-with-cline-windsurf-codex)

## Trust & data handling

Local-first: peek uploads nothing — what your MCP client does with the data is up to you. Captured values are masked at record time; read tools are non-mutating, and write tools require per-origin consent.
