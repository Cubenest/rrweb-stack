<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/core

> The framework-agnostic recording engine behind `tracelane`. Wraps any test runner's `browser` object behind one `BrowserExecutor` interface and drives the rrweb capture. Shared internals — not installed directly.

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

> Exact internal values (cooldown ms, report-size cap) are the calibrated defaults at the time of writing; see [`src/recorder.ts`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-core/src/recorder.ts) and [`src/size-guard.ts`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-core/src/size-guard.ts) for the source of truth.

## API

The public surface is re-exported from [`src/index.ts`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-core/src/index.ts). The load-bearing contract is the `BrowserExecutor` interface that every adapter implements — `@tracelane/core` only ever talks to it, never to a concrete framework driver:

```ts
export interface BrowserExecutor {
  execute<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
  executeAsync<T>(fn: (...args: unknown[]) => void, ...args: unknown[]): Promise<T>;
  cdp(domain: string, command: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
}
```

Also exported: `createRecorder` (the recorder controller), `attachNetworkCapture` (CDP network capture), `loadRrwebBundle`, the `resolveMode` mode switch, and the `pruneToSizeBudget` report-size guard. See [`src/browser-executor.ts`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-core/src/browser-executor.ts) for the full interface docs.

## Related packages

- [`@cubenest/rrweb-core`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/rrweb-core) — the shared rrweb fork + network plugin this engine builds on.
- [`@tracelane/wdio`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) — WebdriverIO adapter (implements `BrowserExecutor`).
- [`@tracelane/playwright`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-playwright) — Playwright adapter (implements `BrowserExecutor`).
- [`@tracelane/report`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-report) — builds the self-contained HTML report from the captured buffer.
- [`@tracelane/cli`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-cli) — wires the adapters together for a project.

## License

Apache-2.0. Contributions require a [DCO](https://developercertificate.org/) sign-off (`git commit -s`).

See the [CHANGELOG](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-core/CHANGELOG.md) for release history and [SECURITY-NOTES](https://github.com/Cubenest/rrweb-stack/blob/main/docs/SECURITY-NOTES.md) for the recording/redaction threat model.
