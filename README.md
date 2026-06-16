<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">&nbsp;&nbsp;<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-peek.svg" height="40" alt="peek">

# rrweb-stack

Two OSS products on one rrweb-based substrate. Both ship as `npm` packages today.

| Product | One line | Install |
|---|---|---|
| **[tracelane](packages/tracelane-wdio/)** | The recorder for your WebdriverIO and Playwright tests — Cypress on the roadmap. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup. | `npx @tracelane/cli init` |
| **[peek](packages/peek-cli/)** | Your real browser, exposed to your AI coding agent over MCP — capture once, query forever, never leaves your machine. | `npm install -g @peekdev/cli && npx peek init` |

![tracelane install — one command](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/tracelane-hero.gif)

*Above: `npx @tracelane/cli init` in a real WebdriverIO project — detect runner, install, edit `wdio.conf.ts`, ignore reports dir.*

![peek query — sessions are structured data](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/peek-hero.gif)

*Above: `peek sessions list` then `peek sessions show ... --format markdown` — a recorded browser session as queryable structured output, AI-ready.*

[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![License](https://img.shields.io/github/license/Cubenest/rrweb-stack.svg)](LICENSE)

## What's where

### tracelane

| Package | Status | What it does |
|---|---|---|
| [`@tracelane/wdio`](packages/tracelane-wdio/) | alpha | WebdriverIO Service — capture + write HTML report |
| [`@tracelane/playwright`](packages/tracelane-playwright/) | alpha | Playwright Reporter + auto-fixture — capture + write HTML report |
| [`@tracelane/cypress`](https://github.com/Cubenest/rrweb-stack/issues) | planned (Q4 2026) | JSON-output adapter (no Test Replay overlap) |
| [`@tracelane/core`](packages/tracelane-core/) | alpha | Framework-agnostic capture engine — depended on by the adapters |
| [`@tracelane/report`](packages/tracelane-report/) | alpha | Self-contained HTML report builder |

Docs: [tracelane.cubenest.in](https://tracelane.cubenest.in) (source under [`apps/tracelane-docs/`](apps/tracelane-docs/)). The [tracelane-wdio README](packages/tracelane-wdio/README.md) is the right starting point.

### peek

| Package | Status | What it does |
|---|---|---|
| [`@peekdev/cli`](packages/peek-cli/) | alpha | `peek init` installer + `peek sessions` query / export |
| [`@peekdev/mcp`](packages/peek-mcp/) | alpha | stdio MCP server — exposes captured sessions to Claude Code, Cursor, Cline, Windsurf |
| [`peek-extension`](packages/peek-extension/) | alpha (CWS submission pending) | Chrome MV3 extension — the real browser, recorded |

Docs: [peek.cubenest.in](https://peek.cubenest.in) (source under [`apps/peek-docs/`](apps/peek-docs/)).

> **peek requires Node.js ≥ 22.** Its native `better-sqlite3` dependency only
> ships prebuilt binaries for Node 22+; on older Node (notably Windows, which
> has no C/C++ toolchain by default) the install falls back to compiling from
> source and fails.

## Shared substrate

`@cubenest/rrweb-core` — vendored PostHog rrweb fork, PII masking primitives, large-DOM throttling, screenshot fallback, network/console capture abstractions, compression helpers. Used by both products. The fork is pinned by SHA + the substrate's NOTICE attributes both PostHog's plugin lineage and the upstream rrweb roots.

## Why two products, one repo

Same recording engine, same trust model, two different consumer surfaces:

- **tracelane** ships test-time captures into a self-contained HTML artifact your team and AI agents can read offline.
- **peek** ships live-browser captures into an MCP server your AI coding agent can query.

Shared upstream means one fork to track, one masking surface to harden, one license + DCO + security policy.

## Pre-launch state

Pre-1.0. Alpha packages live on npm. Branch protection is on `main` (PR + CI + DCO + linear history). All workflows use Trusted Publishing OIDC + SLSA provenance. Renovate runs with a 7-day cooldown (21 days for the `@posthog/rrweb` lineage) and `config:best-practices`. Public launch motion is in progress.

## Contributing

Apache 2.0. DCO sign-off required on all contributions. See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md).

## Sponsor / support

- GitHub Sponsors — [github.com/sponsors/harry-harish](https://github.com/sponsors/harry-harish) *(opening for launch)*
- The work is open-source and sustainable; sponsorship keeps it that way. See [`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md) for the maintenance cadence.
