<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# wdio-tracelane-service

[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

The **WebdriverIO config-wizard / convention name** for the tracelane WebdriverIO service. It records [rrweb](https://github.com/rrweb-io/rrweb) sessions during your WDIO suite and writes a self-contained HTML report on failed tests.

This package adds **no logic** — it is a thin alias that re-exports [`@tracelane/wdio`](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-wdio/README.md). It exists because WebdriverIO resolves a bare service string (`services: ['tracelane']`) to `wdio-tracelane-service`, and the `wdio config` setup wizard only surfaces plugins named per the `wdio-*` convention — which the scoped canonical package `@tracelane/wdio` is not.

## Install

```sh
npm install -D wdio-tracelane-service
```

Then add it to your `wdio.conf.ts`:

```ts
export const config = {
  // ...
  services: [['tracelane', { mode: 'failed' }]],
};
```

The bare `'tracelane'` string resolves to this package. You can equally import the service class directly:

```ts
import TraceLaneService from 'wdio-tracelane-service';

export const config = {
  services: [[TraceLaneService, { mode: 'failed' }]],
};
```

The easiest path is still `npx @tracelane/cli init`, which detects your runner, installs the integration, and wires `wdio.conf` for you.

## What it re-exports

Everything from `@tracelane/wdio`: the default `TraceLaneService`, the `traceLaneHooks` factory (also at `wdio-tracelane-service/hooks`), the option types, and the executor adapter. See the [`@tracelane/wdio` README](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-wdio/README.md) and the [tracelane docs](https://tracelane.cubenest.in) for full usage.

Apache-2.0 · part of [Cubenest/rrweb-stack](https://github.com/Cubenest/rrweb-stack) · local-first, no telemetry.
