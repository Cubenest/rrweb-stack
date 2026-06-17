<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/core

> The recorder for your WebdriverIO and Playwright tests — Cypress on the roadmap. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.

[![npm](https://img.shields.io/npm/v/@tracelane/core.svg)](https://www.npmjs.com/package/@tracelane/core)
[![downloads](https://img.shields.io/npm/dw/@tracelane/core.svg)](https://www.npmjs.com/package/@tracelane/core)
[![license](https://img.shields.io/npm/l/@tracelane/core.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![types](https://img.shields.io/npm/types/@tracelane/core.svg)](https://www.npmjs.com/package/@tracelane/core)
[![node](https://img.shields.io/node/v/@tracelane/core.svg)](https://www.npmjs.com/package/@tracelane/core)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

Framework-agnostic recording engine for `tracelane`. Wraps a per-framework `browser` object behind a common `BrowserExecutor` interface, injects the rrweb capture bundle, drains in-page events to Node, and builds the buffer that the report packages render.

**Not intended for direct consumption** — depend on a product package instead:

```sh
npm install --save-dev @tracelane/wdio        # WebdriverIO Service
npm install --save-dev @tracelane/playwright  # Playwright reporter + fixture
# @tracelane/cypress — planned Q4 2026
```

See the [`@tracelane/wdio` README](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) for the integration guide.

## What's in here

- `BrowserExecutor` — the framework-agnostic surface that adapters implement.
- Recorder controller — in-page buffer install + Node-polled drain.
- Navigation re-injection with a 250ms cooldown + `tracelane.nav` boundary events.
- Mode switch (`'failed' | 'all'`) and a 25 MB FullSnapshot-preserving report-size guard.

Built on [`@cubenest/rrweb-core`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/rrweb-core).

## License

Apache-2.0. Contributions require a [DCO](https://developercertificate.org/) sign-off (`git commit -s`).
