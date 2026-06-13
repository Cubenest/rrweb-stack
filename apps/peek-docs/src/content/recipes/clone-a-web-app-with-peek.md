---
title: "Clone a web app's UI from a real peek session"
lede: "When I rebuild a clunky internal tool, I don't want my agent guessing at its structure from a screenshot. I want the real DOM the page actually rendered."
description: "Point an agent at any web app, let peek record the real DOM and actions, then have it read that capture over MCP and rebuild the app with a modern UI."
type: hero
status: published
publishedAt: 2026-06-15
integrations: [claude-code, cursor]
artifact: /demo
relatedRecipes: [set-up-peek-with-claude-code, generate-playwright-repro-from-real-browser-session, security-review-flow-with-ai-agent]
---

## What you'll end up with

A working rebuild of the app, generated from the real DOM peek recorded instead of a screenshot the agent squinted at. Same behavior, whatever UI you ask for. [Here's one built exactly this way](/demo): a plain TodoMVC, captured and rebuilt with a modern interface, dark mode, and drag to reorder, with the original flow still passing against the new app.

## Prerequisites

- Claude Code or Cursor with MCP enabled
- Chrome with the peek extension loaded (`chrome://extensions` → **Load unpacked** → `packages/peek-extension/chrome-mv3/`; not yet on the Chrome Web Store)
- Whatever stack you want to rebuild in (the example used Vite + React + Tailwind)

## Steps

### 1. Install peek

```bash
npm i -g @peekdev/cli
peek init
```

`peek init` writes the MCP server entry into `~/.claude.json` (and into Cursor / Windsurf if it finds them).

### 2. Capture the app you want to clone

Open it in Chrome, click the peek toolbar icon → **Capture this tab**, and use the app the way a real user would: add something, edit it, filter, navigate between views. peek records the DOM at each of those states plus your action timeline, so the agent sees the structure in every state, not just the first paint. If you want the agent to drive the page itself, raise the origin's permission level in the side panel.

### 3. Let the agent read the capture

In Claude Code or Cursor:

> Read my latest peek session. Pull the DOM at the key states with `get_dom_snapshot`, check how the list changes with `query_dom_history`, then rebuild this app in React and Tailwind with a modern UI. Keep the behavior identical.

The agent calls `list_recent_sessions` to find the session, `get_session_summary` for the lay of the land, then `get_dom_snapshot` and `query_dom_history` to read the real markup and how it changes. It builds from that, not from a guess.

### 4. Rebuild, then prove it still behaves

Once the agent has the new app running, ask it to call `generate_playwright_repro` on the original session and run that spec against the rebuild. If the flow you captured still passes, the clone behaves like the original, and you can keep iterating on the UI freely.

## Why this works

peek hands the agent the DOM, the actions, and the network it actually recorded, so the rebuild starts from ground truth. That is the difference between cloning the real structure and approximating a screenshot. Better context, better decisions, better output.

## Next steps

- [Set up peek with Claude Code](/recipes/set-up-peek-with-claude-code)
- [Generate a Playwright repro from a real browser session](/recipes/generate-playwright-repro-from-real-browser-session)
- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
