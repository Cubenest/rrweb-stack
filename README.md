# rrweb-stack

Two OSS products on one rrweb-based substrate.

## Products

| Product | Description | Packages | Docs |
|---|---|---|---|
| [`tracelane`](packages/tracelane-core/) | Test-run data collector & reporting plugin for WebdriverIO / Playwright / Cypress. Captures rrweb + console + network, ships a self-contained HTML report on failure. | `@tracelane/*` | [tracelane docs](apps/tracelane-docs/) |
| [`peek`](packages/peek-extension/) | Browser companion: Chrome MV3 extension + stdio MCP server + CLI. Brings the user's real authenticated browser to AI coding agents (Claude Code, Cursor, Cline, Windsurf, etc.). | `@peek/*` | [peek docs](apps/peek-docs/) |

## Shared substrate

`@cubenest/rrweb-core` — vendored PostHog rrweb fork, PII masking primitives, large-DOM throttling, screenshot fallback, network/console capture abstractions, compression helpers. Used by both products. See [ADR-0002](prds/adrs/0002-rrweb-posthog-fork-substrate.md).

## Strategy

Two products, two brands, one substrate. See [`prds/shared-preamble.md`](prds/shared-preamble.md).

## Status

Pre-alpha. Side project. See [`prds/IMPLEMENTATION_PLAN.md`](prds/IMPLEMENTATION_PLAN.md) for what's being built and when.

## License

Apache 2.0. DCO sign-off required on all contributions. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
