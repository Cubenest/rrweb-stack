---
title: "Use peek with per-action approval for sensitive flows"
lede: "When I want my agent to click things in a real browser session, I want every write to require my explicit OK — no autonomous side effects."
description: "Configure peek's per-origin permission levels so execute_action requires interactive approval — even when the agent is otherwise running unattended."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [security, claude-code]
relatedRecipes: [security-review-flow-with-ai-agent, claude-code-on-staging, reproduce-bug-from-teammate-peek-session]
---

## What you'll end up with

A peek configuration where read tools (`get_dom_snapshot`, `get_session_network_errors`, etc.) work without prompts, but `execute_action` — the write tool that drives real clicks and keystrokes — pops an authorization prompt for every call. Sensitive origins (banking, prod admin) can be locked to a stricter level than the default.

![peek prompting for authorization on a write action](/recipes/assets/use-peek-with-per-action-approval.png)

## Prerequisites

- Claude Code (or any MCP client) with peek wired in (`peek init` writes the entry to `~/.claude.json`)
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- Familiarity with the origins you want your agent to touch

## Steps

### 1. Understand the five permission levels

peek scopes permission per origin. The five levels are:

- **0 — Off.** No read or write. Default for unknown origins.
- **1 — List only.** Agent can see a session exists; cannot read its contents.
- **2 — Read.** Agent can call `get_dom_snapshot`, `get_session_*` etc. against the origin.
- **3 — Write with approval.** Adds `execute_action`, but every call requires an explicit `request_authorization` prompt.
- **4 — Write without approval.** Same write tools, no prompt. Reserved for sandboxes.

A destructive-action blocklist (clicking on text matching "delete", "remove account", etc.) forces a level-3-style prompt even at level 4.

### 2. Set the default to Level 3 — Write with approval

In the peek extension popup, open **Settings → Permissions**. Set the default for new origins to **3 — Write with approval**.

### 3. Lock sensitive origins higher

For any origin you do not want the agent writing to (your bank, your prod admin panel), set permission explicitly to **0** or **1**. Set permission per-origin in the same panel — these win over the default.

### 4. Walk a flow and approve actions

Ask Claude Code:

> Walk through the checkout flow on staging and click Place Order. Use peek's `execute_action` for the click.

Each `execute_action` call surfaces a prompt in the peek extension showing the target selector, the action verb, and the page URL. Approve only what you intend.

## Notes on data handling

The TrustBanner above is the short form. Worth elaborating for this recipe:

- **Authorization is per call, not per session.** Approving one click does not approve the next one.
- **Approvals are logged.** peek-mcp writes an audit row for every authorization decision (allow / deny / timeout). Audit log lives under `~/.peek/audit/`.
- **The destructive-action override is not a substitute for sane defaults.** It catches the obvious "Delete account" clicks; it does not catch domain-specific destructive actions ("Submit Payment"). Stay at Level 3 for any origin where you are not certain.
- **Level 4 is for sandboxes you own.** Setting an origin to Level 4 disables the prompt — only do this for throwaway test environments.

## Why this works

peek's MCP write tools (`execute_action`, `request_authorization`) check per-origin permission before forwarding to the extension. Level 3 forces an `request_authorization` call to surface a UI prompt; the action only runs after a user click. The blocklist override is a static deny-list inside peek-mcp; it cannot be disabled from the agent side.

## Next steps

- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
- [Let Claude Code reproduce a bug on your authenticated staging dashboard](/recipes/claude-code-on-staging)
- [Reproduce a bug from a teammate's recorded peek session](/recipes/reproduce-bug-from-teammate-peek-session)
