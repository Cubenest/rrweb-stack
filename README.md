<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">&nbsp;&nbsp;<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-peek.svg" height="40" alt="peek">

# rrweb-stack

Two OSS products on one rrweb-based substrate. Both ship as `npm` packages today.

| Product | One line | Install |
|---|---|---|
| **[tracelane](packages/tracelane-wdio/)** | The recorder for your WebdriverIO and Playwright tests — Cypress on the roadmap. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup. | `npx @tracelane/cli init` |
| **[peek](packages/peek-cli/)** | Your real browser, exposed to your AI coding agent over MCP — the agent reads recorded sessions and, with your explicit consent, drives the live page. Never leaves your machine. | `npm install -g @peekdev/cli && npx peek init` |

![tracelane install — one command](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/tracelane-hero.gif)

*Above: `npx @tracelane/cli init` in a real WebdriverIO project — detect runner, install, edit `wdio.conf.ts`, ignore reports dir.*

![peek query — sessions are structured data](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/peek-hero.gif)

*Above: `peek sessions list` then `peek sessions show ... --format markdown` — a recorded browser session as queryable structured output, AI-ready.*

[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![License](https://img.shields.io/github/license/Cubenest/rrweb-stack.svg)](LICENSE)
[![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/Cubenest/rrweb-stack#pre-launch-state)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/CONTRIBUTING.md)
[![Changesets](https://img.shields.io/badge/versioning-changesets-2088FF.svg)](https://github.com/changesets/changesets)
[![Biome](https://img.shields.io/badge/code_style-biome-60a5fa.svg)](https://biomejs.dev)

## What's where

### tracelane

| Package | Status | What it does |
|---|---|---|
| [`@tracelane/wdio`](packages/tracelane-wdio/) | alpha | WebdriverIO Service — capture + write HTML report |
| [`@tracelane/playwright`](packages/tracelane-playwright/) | alpha | Playwright Reporter + auto-fixture — capture + write HTML report |
| [`@tracelane/cypress`](https://github.com/Cubenest/rrweb-stack/issues) | planned | JSON-output adapter (no Test Replay overlap) |
| [`@tracelane/core`](packages/tracelane-core/) | alpha | Framework-agnostic capture engine — depended on by the adapters |
| [`@tracelane/report`](packages/tracelane-report/) | alpha | Self-contained HTML report builder |

Docs: [tracelane.cubenest.in](https://tracelane.cubenest.in) (source under [`apps/tracelane-docs/`](apps/tracelane-docs/)). The [tracelane-wdio README](packages/tracelane-wdio/README.md) is the right starting point.

### peek

| Package | Status | What it does |
|---|---|---|
| [`@peekdev/cli`](packages/peek-cli/) | alpha | `peek init` installer + `peek sessions` query / export |
| [`@peekdev/mcp`](packages/peek-mcp/) | alpha | stdio MCP server — exposes captured sessions, plus consent-gated live read + act tools, to Claude Code, Cursor, Cline, Windsurf |
| [`peek-extension`](packages/peek-extension/) | alpha · [on the Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb) | Chrome MV3 extension — the real browser, recorded |

Docs: [peek.cubenest.in](https://peek.cubenest.in) (source under [`apps/peek-docs/`](apps/peek-docs/)).

> **peek requires Node.js ≥ 22.** Its native `better-sqlite3` dependency only
> ships prebuilt binaries for Node 22+; on older Node (notably Windows, which
> has no C/C++ toolchain by default) the install falls back to compiling from
> source and fails.

## Shared substrate

[`@cubenest/rrweb-core`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/rrweb-core/) — vendored PostHog rrweb fork, PII masking primitives, large-DOM throttling, screenshot fallback, network/console capture abstractions, compression helpers. Used by both products. The fork is pinned by SHA + the substrate's NOTICE attributes both PostHog's plugin lineage and the upstream rrweb roots.

## Why two products, one repo

Same recording engine, same trust model, two different consumer surfaces:

- **tracelane** ships test-time captures into a self-contained HTML artifact your team and AI agents can read offline.
- **peek** ships live-browser captures into an MCP server your AI coding agent can query — and, with your explicit per-origin consent, drive the live page through.

peek's live read + act tools are gated by a five-level per-origin permission model (`0 Off → 1 Read-only → 2 Suggest-only → 3 Act-with-confirm → 4 YOLO`, the default is Level 1) with a destructive-action blocklist that always prompts. No telemetry, no cloud — everything stays in `~/.peek`.

Shared upstream means one fork to track, one masking surface to harden, one license + DCO + security policy.

## Pre-launch state

Pre-1.0. Alpha packages live on npm. Branch protection is on `main` (PR + CI + DCO + linear history). All workflows use Trusted Publishing OIDC + SLSA provenance. Renovate runs with a 7-day cooldown (21 days for the `@posthog/rrweb` lineage) and `config:best-practices`. tracelane has publicly launched (npm alpha + a live demo report); peek is alpha on npm and its Chrome MV3 extension is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/peek/dmgpmkeneheenpdnfmpjjahnkknkaejb).

## Security

Report a vulnerability via [SECURITY.md](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md). The shared threat model for both products lives in [docs/SECURITY-NOTES.md](https://github.com/Cubenest/rrweb-stack/blob/main/docs/SECURITY-NOTES.md).

## License

Apache-2.0. See [LICENSE](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE).

## Contributing

Apache 2.0. DCO sign-off required on all contributions. See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md).

## Sponsor / support

- GitHub Sponsors — [github.com/sponsors/harry-harish](https://github.com/sponsors/harry-harish) *(opening for launch)*
- The work is open-source and sustainable; sponsorship keeps it that way. See [`docs/SUSTAINABILITY.md`](docs/SUSTAINABILITY.md) for the maintenance cadence.
