---
title: "Understand peek's per-action approval model for sensitive flows"
lede: "When I'm thinking about letting an agent drive clicks in a real browser, I want to know exactly what peek's permission model is — what it gates, what it logs, and what it never auto-approves."
description: "peek's five-level permission model, the destructive-action override, and the audit log — the safety guarantees behind every execute_action call."
type: short
status: published
publishedAt: 2026-06-15
integrations: [security, claude-code]
relatedRecipes: [security-review-flow-with-ai-agent, claude-code-on-staging, reproduce-bug-from-teammate-peek-session]
---

## What this recipe covers

peek's MCP server exposes one write tool — `execute_action` — and gates every call against a per-origin permission level. This recipe walks you through that model so you can pick the right level per origin, understand what's logged, and know which actions can never be silently approved. The model and the audit log ship today; the live agent → consent-banner → click round-trip is in active development (see the callout at the end).

![peek's permission settings panel](/recipes/assets/use-peek-with-per-action-approval.png)

## Prerequisites

- Claude Code (or any MCP client) with peek wired in (`peek init` writes the entry to `~/.claude.json`)
- Chrome with the peek extension loaded
- Familiarity with the origins you might want your agent to touch

## The five permission levels

peek scopes permission **per origin**. Set per-origin levels in the extension popup → Settings → Permissions.

- **0 — Off.** No read or write. Default for any origin you haven't explicitly authorized.
- **1 — List only.** The agent can see that a session exists for the origin (via `list_recent_sessions`); cannot read session contents.
- **2 — Read.** Adds `get_session_summary`, `get_dom_snapshot`, `get_session_console_errors`, `get_session_network_errors`, `query_dom_history`, `get_user_action_before_error`, `generate_playwright_repro`. No write tools.
- **3 — Write with approval.** Adds `execute_action`. Every call requires an explicit `request_authorization` confirmation (per-call, not per-session).
- **4 — Write without approval.** Same write tools, no prompt. Reserved for sandboxes you own outright.

## The destructive-action override

Independent of permission level, peek's MCP server enforces a static deny-list of destructive verbs. Clicking on UI text matching any of these phrases triggers a level-3-style prompt **even at level 4**:

```
delete, remove, transfer, send, pay, purchase, buy, confirm,
subscribe, logout, sign out, unsubscribe, cancel subscription,
wire, withdraw
```

The blocklist lives inside peek-mcp (`packages/peek-mcp/src/mcp/destructive-blocklist.ts`) and cannot be disabled from the agent side. It's not exhaustive — domain-specific destructive actions ("Submit Payment", "Approve Refund") won't match — so don't rely on it as your only defence.

## Recommended defaults

- **Default for new origins: Level 0 (Off).** Keep peek opt-in. Authorize an origin only when you want the agent there.
- **Origins you debug from: Level 2 (Read) or Level 3 (Write with approval).** Read is enough for the `claude-code-on-staging` / `security-review-flow-with-ai-agent` workflows.
- **Origins you never want agents touching:** explicitly Level 0 even if "default" is also 0 — the explicit setting documents intent.
- **Never put production origins (bank, prod admin) above Level 1.** No exceptions.

## The audit log

Every authorization decision — allow, deny, timeout, destructive-blocklist trip — gets a row in `~/.peek/audit.log`. Each row contains: timestamp, tool name (`execute_action` / `request_authorization`), client name (e.g. `claude-code`), session ID, action (the verb + target selector), and the outcome.

```bash
tail -f ~/.peek/audit.log
```

Useful for: weekly review ("what did my agent click last week?"), incident response, or just feeling confident that nothing happened without your trace.

## What's shipped today vs in development

Shipped today (peek ≥ 0.1.0-alpha.14):
- The five-level permission model ([Task 3.22](https://github.com/Cubenest/rrweb-stack/blob/main/_context/prds/IMPLEMENTATION_PLAN.md))
- The destructive-action override
- The `execute_action` / `request_authorization` MCP tools (callable; gated by `MissingHostBridge` until IPC lands)
- The audit log writer

In development:
- The cross-process IPC bridge (`LocalSocketHostBridge`) that lets the MCP server in your AI client talk to the Chrome native-host process. Until this lands, `execute_action` returns `bridge not wired in this process` rather than firing the consent banner. The permission model and audit log are still real — they're just not exercised on a live click yet.

Track the IPC layer at [github.com/Cubenest/rrweb-stack/issues](https://github.com/Cubenest/rrweb-stack/issues). When it lands, the recipe step "Ask the agent to perform a write action" becomes live.

## Why this works

Every write call from an MCP client passes through peek-mcp's per-origin permission check before any browser-side action could fire. Read tools at Level 2 give the agent the context to be useful; Level 3's mandatory consent prompt keeps every click in your hands; the destructive-action override catches the obvious mistakes; the audit log catches the rest after the fact.

## Next steps

- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Reproduce a bug from a teammate's recorded peek session](/recipes/reproduce-bug-from-teammate-peek-session)
