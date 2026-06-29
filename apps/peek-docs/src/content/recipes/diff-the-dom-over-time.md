---
title: "Replay how the DOM changed around a failure"
lede: "I want to see how the page actually changed over time — track one element's history, or every change in the seconds around a failure — from the recorded session."
description: "Have your AI agent replay how the DOM changed in a recorded peek session — track one element over time, or every change in a window around a moment."
type: short
status: published
publishedAt: 2026-06-29
integrations: [claude-code, cursor]
relatedRecipes: [security-review-flow-with-ai-agent, generate-playwright-repro-from-real-browser-session, clone-a-web-app-with-peek]
---

## What you'll end up with

A timeline of DOM changes from a recorded session — either one element's attribute/text history, or every change in a short window around a moment you care about.

## Prerequisites

- Claude Code or Cursor with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb)
- A recorded session where a DOM change was part of the problem

See [Set up peek with Cursor](/recipes/set-up-peek-with-cursor) rather than restating the config here.

## Steps

### 1. Track one element over time

> In my latest session, show me how the `#status` banner changed — every attribute and text update.

The agent calls `query_dom_history` in selector mode (a CSS `selector`, optionally an `op` to restrict to attribute or text changes) and gets back that node's ordered change history.

### 2. Or see everything around a moment

> Show me every DOM change in the 5 seconds before the error at that timestamp.

The agent calls `query_dom_history` in window mode instead — passing a `ts` anchor (and optional `windowMs`) to get all changes in the window before it, each with a `target` hint pointing at the element that changed. Selector mode and window mode are separate calls — give one or the other, not both.

### 3. Read the change story

The agent walks the returned changes — added or removed nodes, attribute flips, text edits — to explain what the page did, in order.

## Why this works

peek recorded the DOM as a stream of mutations, so it can answer "what changed, and when" without you replaying the whole session by hand. Selector mode follows one element; window mode shows the neighborhood of a failure — two angles on the same recorded history.

## Next steps

Pair this with [See the causal chain that led to an error](/recipes/what-led-to-this-error) to tie DOM changes to the action and request that drove them.

## Trust & data handling

Read-tier (Level 1), local-only. peek reads the recorded DOM history from `~/.peek`; nothing leaves your machine; captured values are masked at record time.
