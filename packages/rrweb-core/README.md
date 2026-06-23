# @cubenest/rrweb-core
> The shared rrweb capture + masking engine behind tracelane and peek — vendored PostHog fork, PII masking, network/console capture, large-DOM throttling. Not a standalone product.

[![npm](https://img.shields.io/npm/v/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
[![downloads](https://img.shields.io/npm/dw/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
[![license](https://img.shields.io/npm/l/@cubenest/rrweb-core.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![types](https://img.shields.io/npm/types/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
[![node](https://img.shields.io/node/v/@cubenest/rrweb-core.svg)](https://www.npmjs.com/package/@cubenest/rrweb-core)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

Shared rrweb-based capture substrate. Used by [`tracelane`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-core) and [`peek`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-extension).

**Not intended for direct consumption** — depend on a product package instead. It exists to share the masking and capture primitives (PII masking selectors + regex bank, body/header redaction, network/console capture, large-DOM throttling) between the two product families so the privacy and recording behaviour stay identical.

## What's in here

- Vendored PostHog rrweb fork (`@posthog/rrweb@0.0.34`)
- PII masking primitives (selectors + regex bank + body/header redaction)
- Large-DOM throttling defaults (mutation guard, data-URL guard, single-event size cap)
- Shadow DOM adapter
- Screenshot fallback interface
- Network capture abstraction (CDP and `chrome.webRequest` implementations)
- Console capture
- Compression helpers (`fflate`)
- IndexedDB persistence helper
- [Compatibility matrix](https://github.com/Cubenest/rrweb-stack/blob/main/packages/rrweb-core/COMPATIBILITY.md)

## Versioning

Independent semver. Breaking changes are coordinated across `tracelane` and `peek` releases.

## Related packages

The two product families that consume this substrate:

- **tracelane** — failed-test recorder for E2E suites. Start at [`@tracelane/wdio`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) (WebdriverIO) or [`@tracelane/playwright`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-playwright); engine is [`@tracelane/core`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-core).
- **peek** — browser companion for AI coding agents. Install via [`@peekdev/cli`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-cli); the MCP server is [`@peekdev/mcp`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-mcp) and the recorder is [`@peekdev/extension`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/peek-extension).

## License

Apache 2.0. Vendored rrweb fork remains MIT-licensed; see [NOTICE](https://github.com/Cubenest/rrweb-stack/blob/main/packages/rrweb-core/NOTICE).
