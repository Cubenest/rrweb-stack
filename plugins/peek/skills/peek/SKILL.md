---
name: peek
description: Use when the user mentions a recent browser session, an error they just reproduced, "what was the user doing before X", DOM state at some past moment, or wants to turn a manual repro into a Playwright test. Peek exposes 17 MCP tools backed by a local SQLite store of rrweb-captured browser sessions.
---

# peek — local browser-session inspection

Peek is an OSS browser companion for AI coding agents. A Chrome MV3
extension records masked rrweb sessions to a local SQLite store
(`~/.peek/sessions.db`); a stdio MCP server exposes 17 tools that let you
inspect those sessions and (with consent) drive the live browser.

Peek runs entirely on the user's machine. No telemetry, no cloud, no
account. If `~/.peek/sessions.db` is absent, peek isn't installed yet —
direct the user to `npx @peekdev/cli init` and stop.

## When to invoke

Reach for peek when the user mentions any of these:

- "what happened in my last session" / "show me my recent sessions"
- "investigate this error" alongside a manual repro they just performed
- "what was the user doing when X failed" / "what action triggered X"
- "what did the DOM look like when Y happened"
- "turn what I just did into a Playwright test"
- "click the foo button on this page" (write tools, with consent)
- "fill in this form on the page open in my browser" (write tools, with
  consent)

Don't reach for peek when:

- The user is asking about production / remote / non-local data
- A test-runner integration is already in scope — use
  `@tracelane/wdio` (or the upcoming `@tracelane/playwright-reporter`)
  for test-failure capture instead
- The user wants live page introspection at the current moment with no
  prior recording — peek is for *replaying* what was already captured,
  not a live debugger
- The question is about static code, not runtime behavior

## The 17 tools

**Session-forensics read tools (8) — usable at permission Level 1 (Read-only) and above:**

| Tool | When |
|---|---|
| `list_recent_sessions` | Always the first call. Returns `[{ sessionId, origin, startedAt, endedAt, eventCount, ... }]` for the last N sessions. |
| `get_session_summary` | Narrative summary of one session — what the user did, top-level errors, key navigations. Start here after `list_recent_sessions` picks the target. |
| `get_session_console_errors` | All `console.error` / uncaught exceptions in the session, with timestamps. |
| `get_session_network_errors` | All ≥ 400 responses, with request URL, method, status, and (where deep-capture was enabled) redacted body. |
| `get_user_action_before_error` | Walks rrweb input events backward from a given timestamp; returns the last meaningful user action (click target, form input, navigation). Use right after spotting a console/network error. |
| `get_dom_snapshot` | Returns the DOM at a given timestamp as a serialized tree. Use to understand what was on screen when something happened. |
| `query_dom_history` | Given a CSS selector + sessionId, returns every snapshot where that element changed. Good for "when did this element appear/disappear/change text". |
| `generate_playwright_repro` | Turns a session (or a slice of one) into a runnable Playwright test stub. Selectors are best-effort from rrweb metadata; surface to the user for review before assuming they'll work. |

**Live-page read tools (2) — Level 1+; non-mutating; for the page open in the browser RIGHT NOW (not a past recording):**

| Tool | When |
|---|---|
| `get_page_view` | A compact, masked list of the live page's interactive/labeled elements, each with a stable `ref` (e.g. `e5`). Pass a `ref` to `execute_action` / `request_authorization` instead of authoring a CSS selector — deterministic and far cheaper than `get_dom_snapshot`'s HTML. Refs expire on navigation; re-call after navigating. |
| `get_element_detail` | Full masked detail for ONE element by its `ref` from `get_page_view` (role, accessible name/description, aria-*, a curated computed-style bag, value, href, nearby heading, interactive descendants). Call only for the element you need to disambiguate or act on. |

**Act tools (2) — Level 3+; every call is audit-logged to `~/.peek/audit.log`:**

| Tool | When |
|---|---|
| `request_authorization` | Ask the user to authorize a specific action against a specific origin via the side-panel banner. On Allow it returns a one-shot `confirmToken` to pass to `execute_action`. Call this BEFORE `execute_action` at Level 3, or to pre-authorize. |
| `execute_action` | Performs a click / type / navigate in the user's live browser. Gated by the per-origin level: **Level 3** prompts a confirm banner per action (unless a `confirmToken` is passed); **Level 4** auto-allows non-destructive actions; below Level 3 it's denied. The destructive-action blocklist (delete/send/pay/…) always prompts, even at Level 4. |

**Suggest tools (2) — Level 2+; non-mutating:**

| Tool | When |
|---|---|
| `suggest_element` | Draw a non-destructive highlight overlay on a CSS selector (optional label) to point something out. Never clicks, types, or navigates. |
| `clear_highlight` | Remove the highlight overlay drawn by `suggest_element`. |

**Control tools (2) — Level 4 with the control shield up:**

| Tool | When |
|---|---|
| `set_intent` | Set the agent's status-banner text on the control shield (e.g. "Applying to Senior Frontend · step 2/4") so the user can follow what you're doing. |
| `request_user_input` | Pause the agent and hand the keyboard back to the user for one editable field (or a free-text prompt) — a CAPTCHA, an OTP, a final review — then resume. |

**Audit tool (1) — read-only; no permission level required:**

| Tool | When |
|---|---|
| `verify_audit_log` | Verify peek's local action audit log (`~/.peek/audit.log`) is an intact, tamper-evident hash chain. Returns status: `intact`, `broken`, `truncated`, `tail-tampered`, `prefix-tampered`, `gaps`, `incomplete-final`, or `head-missing`. Call when the user asks whether the audit log is intact, before sharing an audit bundle, or after receiving one. |

## Workflow

The shape of almost every peek conversation:

```
1. list_recent_sessions
   → pick the sessionId the user means (usually the most recent;
     prompt if ambiguous)

2. get_session_summary(sessionId)
   → understand what happened in plain language

3. Drill down based on the user's question:
   - errors      → get_session_console_errors / get_session_network_errors
   - timing      → get_user_action_before_error(sessionId, atTimestamp)
   - DOM state   → get_dom_snapshot(sessionId, atTimestamp)
   - element history → query_dom_history(sessionId, selector)
   - repro test  → generate_playwright_repro(sessionId, fromTs, toTs)

4. (Optional, gated) write tools — only when the user explicitly asks
   peek to *do* something in their browser:
   - destructive? → request_authorization first, surface the prompt,
                    only then execute_action
   - safe (read-only-equivalent click)? → execute_action with the
                    least-privilege scope
```

## Examples

### Investigating a 500 error from a manual repro

User: "I just got a 500 on the dashboard, what happened?"

```
1. list_recent_sessions
   → grab the most recent session for the dashboard origin
2. get_session_network_errors(sessionId)
   → find the 500: POST /api/save, body field "name" was empty
3. get_user_action_before_error(sessionId, errorTs)
   → user clicked "Save" with empty form
4. (optional) get_dom_snapshot(sessionId, errorTs - 100)
   → confirm the form state right before the click
5. Tell the user: "You submitted /api/save with an empty `name` field,
   the server returned 500. The form's required-field validation didn't
   fire. Want me to add a Playwright test for this?"
```

### Generating a Playwright test from a manual repro

User: "Write a Playwright test for the bug I just reproduced."

```
1. list_recent_sessions
   → the most recent session
2. get_session_summary(sessionId)
   → confirm with the user: "I see you logged in, opened settings,
     clicked Delete account, saw the confirmation dialog, and the
     test fails when the dialog closes early — is this what you
     want a test for?"
3. generate_playwright_repro(sessionId)
   → returns a test file stub
4. Show the user the stub; ask which selectors look fragile.
```

### Clicking a button on the user's live browser (consent flow)

User: "Click the Save button on the page I have open."

```
1. Identify the target origin from list_recent_sessions OR from context
2. request_authorization({
     tool: 'execute_action',
     origin: 'https://app.example.com',
     action: 'click',
     selector: '#save-button',
     destructive: false,
   })
   → surface the consent prompt to the user
3. If approved → execute_action with the same args
4. If declined → say so and stop. Do not retry.
```

## Permission model

Peek uses a five-level per-origin model (ADR-0010). The level lives in the
extension (`chrome.storage.sync`, key `peek:permissionLevels`); the user
manages it via the side panel's trust dial. A freshly-enabled origin defaults
to **Level 1 (Read-only)**.

- **Level 0 — Off** — tool surface disabled for the origin (recording suppressed)
- **Level 1 — Read-only** (default) — all 10 read tools (8 session-forensics + 2 live-page); no action execution
- **Level 2 — Suggest-only** — read + non-mutating highlight overlay
  (`suggest_element` / `clear_highlight`); no DOM mutation
- **Level 3 — Act-with-confirm** — read + `execute_action` (click/type/navigate),
  each prompting Allow once / Always for this site / Deny
- **Level 4 — YOLO this session** — read + non-destructive actions auto-allowed
  with no prompt; auto-expires on tab close or after 60 min; also unlocks
  `set_intent` / `request_user_input` while the control shield is up

There is no Level 5. The destructive-action blocklist (delete/send/pay/…) is a
cross-level override that **always** prompts — including at Level 4 — not a level.

If a tool returns `{ error: 'permission_denied', origin, currentLevel,
requiredLevel }`, tell the user how to escalate (via the side panel)
and stop. Don't retry, don't suggest workarounds.

## Safety floor

- Never invent sessions. If `list_recent_sessions` returns empty, say so
  and suggest the user record a session via the extension.
- Never invent tool names. The 17 above are the entire surface.
- Selector results from `generate_playwright_repro` are derived from
  rrweb event metadata. Surface them for review; don't claim a generated
  test is production-ready without the user confirming.
- Destructive write actions (form submits, navigation off-page, deletes)
  ALWAYS require a fresh `request_authorization` call. Never reuse a
  prior authorization for a different action.

## See also

- npm: <https://www.npmjs.com/package/@peekdev/cli> · <https://www.npmjs.com/package/@peekdev/mcp>
- Source: <https://github.com/Cubenest/rrweb-stack>
- Docs: <https://peek.cubenest.in>
- Privacy policy: <https://github.com/Cubenest/rrweb-stack/blob/main/docs/peek/PRIVACY_POLICY.md>
