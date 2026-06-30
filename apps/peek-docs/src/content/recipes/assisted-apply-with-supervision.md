---
title: "Let an AI agent assist a job application while you supervise"
lede: "I want the agent to fill the boring parts of an application from my résumé — I review every step, I do the final submit myself, and I can stop it instantly."
description: "Use peek's Level-4 control shield + input handoff so an MCP agent fills application forms from your résumé under a visible shield and hands you the rest."
type: hero
status: published
publishedAt: 2026-06-15
updatedAt: 2026-06-29
integrations: [claude-code, cursor, security]
relatedRecipes: [use-peek-with-per-action-approval, security-review-flow-with-ai-agent, generate-playwright-repro-from-real-browser-session]
---

## What this covers — and what it deliberately does not

Filling out job applications is tedious: the same name, the same work history, the same "tell us about a time you…" boxes, over and over. This recipe lets an MCP agent (Claude Code, Cursor, or any client) do the boring parts — map fields from your résumé and type them in — while peek's control shield keeps you watching the whole time and lets you take the keyboard back whenever it matters.

It is built to be **supervised, single-user, human-in-the-loop**:

- **One application at a time, you present.** There is no queue, no "apply to 100 jobs", nothing headless. The agent works at human pace in your own logged-in browser.
- **You do the final submit.** The agent fills; you review and click the last button yourself.
- **You can stop instantly.** The shield's Stop control (and Esc) drops the origin to Level 1 the moment you want it to.

What this is **not**: a mass auto-apply bot, a résumé parser, or a CAPTCHA solver. peek ships none of that. The agent reads your résumé from its own context and reasons about the live page; peek just provides the shield, the handoff, and the audit trail.

## ⚠️ Before you use this on LinkedIn

LinkedIn's User Agreement (§8.2) **prohibits using bots or automation to access the service.** Automated activity can get your account restricted or permanently banned. peek cannot make that risk go away.

So the recommended target for anything you care about is **your own employer's ATS or a company career site** — Greenhouse, Lever, Workday, and the like — where filling a form with *your own data* under your own supervision is far less contentious. Treat LinkedIn as an advanced, at-your-own-risk example only, and never run this anywhere you are not authorized to.

This recipe is documented primarily as a **general assisted-apply pattern for your own ATS / company career sites**. It is assistive, not autonomous-at-scale: you are watching the whole time, you perform the final submit, and it runs in your own authenticated session.

## Prerequisites

- **peek installed and wired into your agent** — the extension loaded in Chrome and the native host running. (`peek init` writes the MCP entry to your client config.)
- **A build with the shield + handoff** — `@peekdev/extension` ≥ `0.1.0-alpha.16` and `@peekdev/mcp` ≥ `0.1.0-alpha.19`. Earlier builds expose `execute_action`, `suggest_element`, `request_authorization`, and `clear_highlight`, but **not** `set_intent` (banner narration) or the `request_user_input` handoff. On an earlier build the flow still works — the agent narrates each phase in chat instead of scripting the banner, and instead of a field/page handoff it stops and asks you to do the out-of-page / judgment step (file picker, essay, CAPTCHA, final submit) directly, then continues on your confirm.
- **You are already logged in** to the target site in your own browser. peek never asks for or stores credentials.
- **Your résumé is available to the agent** — pasted into the conversation or shared as a file the agent can read.
- **You understand the target site's terms** (see the LinkedIn warning above).

## Step 1 — arm the shield

Set the target origin to **Level 4 (Auto)** in the extension's per-origin permissions. At Level 4 the **control shield** appears: a banner across the top telling you what the agent is doing, a scrim that absorbs your accidental clicks and keystrokes so they cannot collide with the agent's, and a **Stop** control.

While the shield is up:

- **Stop (and Esc)** instantly drops the origin to **Level 1** — a hard kill-switch.
- **You can still scroll** to follow along; the shield is there to keep your input from clashing, not to blind you.

Level 4 is the only level the shield exists at — which is exactly what makes the supervision visible. Reserve it for this flow and lower the dial when you are done.

## Step 2 — point the agent

Give the agent your résumé and a clear, bounded instruction. An example prompt:

> Here's my résumé. Find Senior Frontend roles on <site> and start an application. Fill what you can from my résumé. Hand me anything you're unsure about — essays, salary, anything that needs judgment. **Never click Submit or Apply — I'll do that myself.**

The agent will set the origin to Level 4 (it should ask you first), narrate what it is doing, read the live DOM to choose fields, and type your mapped data in under the shield.

## Step 3 — watch the banner

Two visual cues tell you what is happening:

- **Intent narration.** The agent calls `set_intent` to put a high-level status string in the banner — "Applying to Senior Frontend at Acme · step 2 of 4" — instead of a low-level "Typing into #field-3". A good agent updates this before each phase so the banner reads like a truthful narrative.
- **Element rings.** The agent calls `suggest_element` to draw a ring around the control it is about to act on, so you can see *where* on the page it is working before it does anything.

If the banner ever stops matching what you expect, Stop first and ask questions second.

After each fill the agent re-reads to confirm it took before advancing the banner — see [Verifying each applied step](#verifying-each-applied-step).

## Step 4 — your-turn moments

When the agent reaches something it should not or cannot do, it hands the keyboard back. There are two shapes of handoff:

- **Field-scope handoff.** The agent unlocks a single field for you — a free-text essay, a salary box — and the rest of the page stays shielded. You type your answer, the agent reads your value back, and the shield re-raises.
- **Page-scope handoff.** For a CAPTCHA (often a cross-origin iframe), a native date/file widget, or the **final review-and-submit**, the agent drops the shield for the *whole page*. The banner stays up with a peek-authored framing line and a **Resume** button so you know peek is paused, not gone. You do whatever the page needs, then click **Resume** to re-raise the shield.

Page-scope is full takeover: while it is active you are driving the entire page — including any Submit, Pay, or Delete control — and peek's destructive matcher does not run on *your own* clicks. Use it only when you mean to take over, and read the framing line: instructions in the card below it are written by the AI, not by peek.

## Step 5 — finish

You perform the final submit yourself, from a page-scope handoff, after reviewing what the agent filled. Then lower the dial (or hit Stop) to bring the shield down and return the origin to a normal level.

## Verifying each applied step

"Apply **and re-verify**": the agent should confirm each field actually took before moving to the next — not fire-and-forget.

1. After it fills a field (`execute_action` type), it re-reads that element with `get_element_detail` and checks the value now matches what it intended.
2. It calls `get_page_view` to confirm no validation or error appeared near the field (wrong format, "already taken", required-but-empty, …).
3. Only then does it advance the `set_intent` banner to the next step. If a step didn't take, it **stops and tells you on the banner** instead of retrying blindly — so you see exactly where it got stuck and can take over.

Heads-up: `password`/email/PII field values come back **masked** (the same masking the recorder applies), so the agent can't confirm those by value — it verifies them by the *absence* of an error instead.

## Signal the outcome

When the loop is finished, have the agent end with a clear terminal status so you can see how it went at a glance:

> When you've completed all the steps, call `set_intent` with `status: "done"` and a short summary. If you had to stop because a step didn't take, call `set_intent` with `status: "failed"` and a one-line reason.

The shield shows this as a green "done" banner (which clears itself after a few seconds) or a red "failed" banner that stays up until something supersedes it — you Stop, Resume, or lower the trust level, or the agent moves on with another status — so a failed run never quietly disappears on its own.

## Safety recap — honest about what is enforced vs convention

It matters to be precise about which protections are real gates and which are just good habits.

**Enforced (real gates):**

- **The shield blocks your accidental input** while it is up, so your stray clicks and keystrokes cannot collide with the agent's.
- **The destructive blocklist forces a confirmation even at Level 4** for actions whose target text matches a destructive term — `pay`, `purchase`, `buy`, `confirm`, `delete`, `remove`, `send`, `transfer`, `withdraw`, `wire`, `subscribe`, `unsubscribe`, `cancel subscription`, `logout`, `sign out`. This fires regardless of permission level and cannot be turned off from the agent side.
- **The audit log records every action** the agent takes (including `set_intent`), in `~/.peek/audit.log`.
- **Stop instantly drops the origin to Level 1**, and the side-panel dial is the canonical kill-switch.

**Convention (not a gate):**

- "The agent doesn't click Submit or Apply" is a **prompt convention, not an enforced rule.** `submit` and `apply` are **not** in peek's destructive blocklist, so at Level 4 the agent *can* technically click an "Apply" or "Submit application" button (and a stray Enter can submit a form without a click). "The agent never submits" rests on (a) the agent obeying your prompt, (b) you watching the banner and Stopping first, and (c) you doing the submit yourself via a page-scope handoff.
- **For a hard backstop, add the terms yourself.** Put `submit` and `apply` into the destructive list via your `~/.peek/policy.json`:

  ```json
  {
    "destructiveTerms": { "add": ["submit", "apply"] }
  }
  ```

  This is a **global, case-insensitive substring** setting in a **user-owned file** the native host re-reads on each request — the agent cannot set or override it. With it in place, the destructive override fires before any Submit/Apply click and forces a confirmation. The trade-off is that it is coarse: it will also force a confirm on unrelated labels like "Submit feedback" or "Apply filters". That is the cost of a hard backstop; decide for yourself.

**Recording honesty:** anything you type into the page during a supervised session is **recorded and AI-visible** — except `password`-type inputs, which the capture engine masks. Both kinds of handoff suspend live recording for their window, but a non-password value you type and **leave** in a field is captured by the next full DOM snapshot once recording resumes, and is then readable by the agent. **Page-scope is not a privacy boundary for typed-and-left content.** Reserve it for ephemeral interaction (a CAPTCHA that clears, a button click, the review-and-submit) and do not type secrets into the page expecting them to stay private.

## Why this works

Every protection that matters here is structural, not cosmetic. The shield makes supervision visible and absorbs your accidental input. The destructive blocklist catches the obvious mistakes even at the most permissive level. The audit log catches the rest after the fact. Stop is a real, instant kill-switch. And where the protection is only a convention — the no-Submit rule — this recipe tells you so plainly and hands you a real backstop you can switch on.

## Next steps

- [Understand peek's per-action approval model for sensitive flows](/recipes/use-peek-with-per-action-approval)
- [Security-review a flow by letting your agent inspect the live DOM](/recipes/security-review-flow-with-ai-agent)
- [Generate a Playwright repro from a real browser session](/recipes/generate-playwright-repro-from-real-browser-session)
