# What I'm building, and why

*Draft for harish.dev. Not part of the project docs. First-person, terse, no marketing voice — same tone as `docs/SUSTAINABILITY.md`. Publish when ready; cross-link from the project README's "Background" section but don't lead with it.*

---

I've shipped two OSS products this month: **tracelane** and **peek**. They share a recording engine and a trust model. Neither has a SaaS, a dashboard, or a signup. Both work fully offline. This post is the why.

## tracelane

> *The reporter for your WebdriverIO, Playwright, and Cypress tests. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.*

I have lost many afternoons to a CI line that says "Element not visible: `[data-test=submit]`" and nothing else. The screenshot tells me the page is white. The console log is empty because the assertion fired before the app got to throw anything. The video, if there is one, is hosted on a vendor I'd rather not pay for, behind an auth wall I'd rather not maintain, and gone in 30 days.

The fix is not novel. [rrweb](https://www.rrweb.io) records the DOM and console at usable fidelity. The novel part is the constraint I want to enforce: the resulting artifact must be a **single `.html` file on disk** that opens in any browser, fully offline, with the player and event blob inlined. No cloud upload. No signup. Attach it to a Jira ticket, drop it in Slack, archive it in S3, send it to a contractor outside your network — it's just a file.

Tracelane is one WebdriverIO **Service** that injects rrweb, drains the in-page buffer on a poll, attaches CDP for failed-network capture, and builds the HTML when a test fails. The Playwright and Cypress integrations follow the same pattern; they ship later in the year.

The closest commercial equivalents are Cypress Cloud, Replay.io, and Sentry Session Replay. They're all good products. I just didn't want to operate infrastructure for a side project, and the self-contained HTML constraint genuinely changes the shape of "where can this artifact live?" — your bug tracker doesn't need to learn about a new vendor.

## peek

> *Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine.*

Claude Code, Cursor, Cline, Windsurf — they're all blocked on the same thing: they don't know what's actually in the browser tab I'm asking them about. They can read the source on my disk. They can read documentation. They cannot see the rendered DOM, the network panel, or the `console.error` that just fired in the iframe I'm wrestling with. When I describe a bug in plain English they reconstruct what I see from text alone, which is the conversational equivalent of fixing a JavaScript bug over a phone call.

Peek is a Chrome MV3 extension plus a stdio MCP server. You enable it per-origin from the side panel (off by default for every site). It records via the same `@cubenest/rrweb-core` substrate tracelane uses, writes into a local SQLite DB at `~/.peek/sessions.db`, and exposes ~20 read-only tools to your AI client over MCP. Your agent can now ask: *"console errors from the last 10 seconds"*, *"network requests with status >= 400 on `example.com`"*, *"reconstruct the DOM at the timestamp the click happened"*. Write operations (clicks, inputs, navigation) exist but require explicit per-action authorization recorded in an audit log.

There is no remote. The MCP transport is stdio. Your agent launches `peek-mcp` as a child process, talks to it over stdin/stdout, kills it on exit. Captures live in your home directory until you delete them. The Chrome Web Store submission is pending; alpha testers load the extension unpacked.

## Why one repo, two packages, one fork

Both products record. The recorder is the same. So I forked PostHog's well-maintained rrweb lineage into [`@cubenest/rrweb-core`](https://www.npmjs.com/package/@cubenest/rrweb-core), pinned to a specific commit, with the masking primitives and screenshot fallback I needed already in place. PostHog's fork is ahead of upstream on the things I cared about — masking, large-DOM throttling — and behind on a few things I don't. The fork is vendored (not a transitive npm dep) because the Shai-Hulud 2.0 supply-chain wave in late 2025 made me reconsider the cost of every transitive dep that touches user DOM. One pinned SHA, one audit surface, two products downstream.

Two products in one repo because the recorder is the load-bearing piece. Splitting them at this stage would mean syncing the fork across two repos manually. When they each justify their own release cadence, they can split.

## Honest pre-1.0 disclosure

This is alpha. Every package version starts with `0.1.0-alpha.` The API may shift. Branch protection is on `main` (PR + 1 review + CI + DCO + linear history). Every publish goes through npm Trusted Publishing OIDC and ships with SLSA provenance. Renovate runs with a 7-day cooldown (21 days for the `@posthog/rrweb` lineage). [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack) runs weekly. I'm one person; the sustainability budget is documented at [`docs/SUSTAINABILITY.md`](https://github.com/Cubenest/rrweb-stack/blob/main/docs/SUSTAINABILITY.md).

## How to start

```sh
npx @tracelane/cli init  # WebdriverIO project: install + wire in one command
npm i -g @peekdev/cli    # peek: CLI install, then `peek init` wires the MCP
```

Apache 2.0. DCO sign-off on contributions. No telemetry from either tool. Issues + PRs at [`Cubenest/rrweb-stack`](https://github.com/Cubenest/rrweb-stack).

If you find these useful, [GitHub Sponsors](https://github.com/sponsors/harry-harish) keeps them maintained at the cadence I can sustain alongside a day job.

— Harish
