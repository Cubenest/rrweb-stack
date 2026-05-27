# @tracelane/core

Framework-agnostic recording engine for [`tracelane`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-core). Wraps a per-framework `browser` object behind a common `BrowserExecutor` interface, injects the rrweb capture bundle, drains in-page events to Node, and builds the buffer that the report packages render.

Not intended for direct consumption — depend on a product package (`@tracelane/wdio`, `@tracelane/playwright`, `@tracelane/cypress`) instead.

## What's in here

- `BrowserExecutor` — the framework-agnostic surface that adapters implement (see [ADR-0004](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0004-p1-wdio-service-not-reporter.md)).
- Recorder controller — in-page buffer install + Node-polled drain (see [ADR-0006](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0006-p1-in-page-buffer-node-polled.md)).
- Navigation re-injection with a 250ms cooldown + `tracelane.nav` boundary events.
- Mode switch (`'failed' | 'all'`) and a 25 MB FullSnapshot-preserving report-size guard (see [ADR-0005](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0005-p1-failed-only-self-contained-html.md)).

Built on [`@cubenest/rrweb-core`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/rrweb-core).

## License

Apache-2.0. Contributions require a [DCO](https://developercertificate.org/) sign-off (`git commit -s`).
