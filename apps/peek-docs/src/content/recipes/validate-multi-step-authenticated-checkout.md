---
title: "Validate a multi-step authenticated checkout with an AI agent watching"
lede: "When I'm about to ship a checkout change, I want an agent to walk the full flow with me and tell me what broke before QA does."
description: "Walk through a multi-step checkout with peek capturing each step, then ask your agent to verify every form post, redirect, and state transition is correct."
type: short
status: draft
publishedAt: 2026-06-15
integrations: [claude-code, validation]
relatedRecipes: [generate-playwright-repro-from-real-browser-session, security-review-flow-with-ai-agent, compare-staging-and-prod-page-versions]
---

## What you'll end up with

A pass/fail validation report from Claude Code covering every step of a checkout — cart → address → payment → confirmation — with the actual network call shapes and DOM state at each transition. Catches "I shipped a missing field on step 3" before QA opens the issue.

![Claude Code validating a checkout flow step by step](/recipes/assets/validate-multi-step-authenticated-checkout.png)

## Prerequisites

- Claude Code with peek wired in (`peek init` adds the MCP entry to `~/.claude.json`)
- Chrome with the **peek** extension installed — from the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb), or loaded unpacked from `packages/peek-extension/chrome-mv3/` for local builds
- A staging checkout you can walk end-to-end

## Steps

### 1. Capture the flow

Open the cart page in Chrome. Click the peek toolbar icon → **Capture this tab**. Walk the full flow: add to cart, sign in if needed, enter shipping, pick payment, confirm. Stop the capture.

### 2. Ask Claude Code to validate

> Walk through my most recent peek session step by step. For each user action, report the network calls fired, whether they returned 2xx, and whether the DOM advanced to the expected next state.

Claude Code calls `get_session_summary` to get the timeline, then `get_user_action_before_error` and `get_session_network_errors` to spot any step where the response or DOM didn't match expectation.

### 3. Read the report

The agent returns a per-step table. Steps that look fine are one line each; broken steps include the failing network call envelope and the DOM diff between the expected and actual next state.

## Why this works

A traditional smoke test asserts "the order placed" — it can't tell you that the shipping-rate API silently fell back to a default. peek's per-step capture gives the agent enough resolution to spot the regression that didn't break the final assertion.

## Next steps

- [Generate a Playwright repro from a real browser session](/recipes/generate-playwright-repro-from-real-browser-session)
- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
- [Have your agent compare the staging and prod versions of a page](/recipes/compare-staging-and-prod-page-versions)
