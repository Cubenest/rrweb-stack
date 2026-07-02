---
title: "Find a past session by what happened"
lede: "When I vaguely remember a bug from a past session but can't recall the exact sessionId, I want my agent to search for it by keyword, origin, or date."
description: "Use search_sessions to locate a recorded session by text, origin, date range, or error presence — then drill in with get_session_summary to confirm it."
type: short
status: published
publishedAt: 2026-07-02
integrations: [claude-code, cli]
relatedRecipes: [triage-console-errors-from-a-recorded-session, find-the-network-call-that-broke-the-flow, what-led-to-this-error]
---

## What you'll end up with

A confirmed sessionId for the session you half-remember — found by keyword, origin, date window, or error presence — ready to pass to any forensic tool.

## Prerequisites

- Claude Code or another MCP client with peek wired in (`peek init` adds the MCP entry automatically)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
- At least one recorded session in `~/.peek/sessions.db`

## With your AI agent (MCP)

### 1. Search by keyword or origin

> Find the peek session where I was testing the checkout page on localhost.

The agent calls `search_sessions` with a text query and/or origin filter:

```
search_sessions({ q: "checkout", origin: "http://localhost:3000" })
```

Returns an array of matching sessions — same shape as `list_recent_sessions` — each with `sessionId`, `origin`, `startedAt`, `endedAt`, and `eventCount`.

### 2. Narrow by date or error presence

> Show me sessions from last Tuesday on staging that had network errors.

```
search_sessions({
  origin: "https://staging.example.com",
  since: "2026-06-24",
  until: "2026-06-25",
  errors: "network"
})
```

`errors` accepts `"console"`, `"network"`, or `"any"` to filter to only sessions where peek captured at least one error of that type.

### 3. Confirm and drill in

Once the agent has a candidate, it calls `get_session_summary(sessionId)` to confirm: "Is this the checkout session where the payment button froze?" If it matches, hand the `sessionId` to any forensic tool — `get_session_console_errors`, `get_session_network_errors`, `generate_playwright_repro`, etc.

## With the CLI (`peek sessions search`)

```bash
# Text search
peek sessions search --q "checkout"

# Origin + date window
peek sessions search --origin https://staging.example.com --since 2026-06-24 --until 2026-06-25

# Sessions that had console errors, latest 5
peek sessions search --errors console --limit 5

# Machine-readable output
peek sessions search --q "payment" --json
```

**Flags:**

| Flag | Description |
|---|---|
| `--q <text>` | Match text in session title, URL, or origin |
| `--origin <url>` | Filter to a specific origin (scheme + host + port) |
| `--since <date>` | Sessions that started on or after this date (ISO 8601) |
| `--until <date>` | Sessions that started on or before this date (ISO 8601) |
| `--status <value>` | Filter by status (`active`, `closed`) |
| `--errors <type>` | Only sessions with errors: `console`, `network`, or `any` |
| `--limit <n>` | Max rows to return (default: 20) |
| `--json` | Emit newline-delimited JSON for scripting |

**`--json` example** (pipe to `jq` for scripting):

```bash
peek sessions search --q "checkout" --json | jq '.[0].sessionId'
```

## Trust & data handling

`search_sessions` is a read-only tool (Level 1) — it never acts on the page or modifies any session data. Local-first: peek uploads nothing — what your MCP client does with the data is up to you. The search matches session metadata only (title/URL/origin) — not page content or error-message text; read-only and local.
