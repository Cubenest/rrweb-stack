# @tracelane/core

> The reporter for your WebdriverIO, Playwright, and Cypress tests. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.

Framework-agnostic recording engine for `tracelane`. Wraps a per-framework `browser` object behind a common `BrowserExecutor` interface, injects the rrweb capture bundle, drains in-page events to Node, and builds the buffer that the report packages render.

**Not intended for direct consumption** — depend on a product package instead:

```sh
npm install --save-dev @tracelane/wdio    # WebdriverIO Service
# @tracelane/playwright — planned Q3 2026
# @tracelane/cypress    — planned Q4 2026
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
