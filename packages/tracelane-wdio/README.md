# @tracelane/wdio

> The reporter for your WebdriverIO, Playwright, and Cypress tests. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.

[![npm](https://img.shields.io/npm/v/@tracelane/wdio.svg)](https://www.npmjs.com/package/@tracelane/wdio)
[![downloads](https://img.shields.io/npm/dw/@tracelane/wdio.svg)](https://www.npmjs.com/package/@tracelane/wdio)
[![license](https://img.shields.io/npm/l/@tracelane/wdio.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)

![tracelane install — one command](https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/tracelane-hero.gif)

```sh
cd your-wdio-project
npx @tracelane/cli init
```

That's it. [`npx @tracelane/cli init`](https://www.npmjs.com/package/@tracelane/cli) detects your runner, installs `@tracelane/wdio`, edits `wdio.conf.ts` in place, and gitignores the reports directory. Idempotent (re-run is a no-op) and dry-runnable (`--dry-run`).

Run your suite. On a failing test you get a single `.html` file at `./tracelane-reports/<spec>--<title>--<cid>-<ts>.html` — open it in any browser, fully offline. Replay the run with [rrweb-player](https://www.rrweb.io), inspect the console + failed-network panels, attach to your bug tracker, archive it forever. No upload, no signup, no cloud.

### Or wire it manually

```sh
npm install --save-dev @tracelane/wdio
```

```ts
// wdio.conf.ts
import TraceLaneService from '@tracelane/wdio';

export const config = {
  // ...your existing config
  services: [[TraceLaneService, { mode: 'failed' }]],
};
```

Same result — `npx @tracelane/cli init` is just the orchestration that does the lines above for you.

## What this is NOT

- Not Cypress Cloud, Replay.io, or Sentry Session Replay. There is no SaaS to host. There is no signup. There is no dashboard. There is no telemetry. The artifact is a single HTML file on your filesystem.
- Not a reporter (in the `@wdio/reporter` sense). `tracelane` is a WDIO **Service** because only a Service can attach to the live browser, inject the rrweb recorder, drain the in-page buffer, and use CDP for network capture ([ADR-0004](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0004-p1-wdio-service-not-reporter.md)). A paired Allure **Reporter** shim is planned for v1.1.
- Not just for failures. `mode: 'all'` writes a report for every test — useful as a CI artifact, evidence in a PR, or a "what changed between green and red" diff.

## Full example

```ts
// wdio.conf.ts
import type { Options } from '@wdio/types';
import TraceLaneService from '@tracelane/wdio';

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./test/specs/**/*.ts'],
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': { args: ['--remote-debugging-port=9222', '--no-sandbox'] },
    },
  ],
  services: [
    ['devtools', {}], // enables browser.cdp(...) for network capture — see "Network capture" below
    [
      TraceLaneService,
      {
        mode: process.env.TRACELANE_MODE ?? 'failed', // 'failed' | 'all'
        outDir: './tracelane-reports',
        capture: { rrweb: true, network: true, console: true },
      },
    ],
  ],
  reporters: ['spec'],
};
```

`webdriverio` and `@wdio/types` are **peer dependencies** (`^9.0.0`); you already have them in a WDIO project.

## How it works

- On the first test, the Service injects an rrweb recorder bundle into the page and installs an in-page event buffer (`window.__tracelane__events`).
- The Node side drains that buffer on a poll (default every 5 s) and on every `afterTest`, re-injecting on navigation ([ADR-0006](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0006-p1-in-page-buffer-node-polled.md)).
- In `failed` mode (default) a passing test discards its buffer; a failing test's buffer is handed to [`@tracelane/report`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-report), which builds the single offline HTML (≤ 25 MB, [ADR-0005](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0005-p1-failed-only-self-contained-html.md)).

## Options

| Option | Type | Default | Notes |
|---|---|---|---|
| `mode` | `'failed' \| 'all'` | `'failed'` | `failed` writes a report only on failure; `all` on every test. `TRACELANE_MODE` env var overrides this. |
| `outDir` | `string` | `'./tracelane-reports'` | Report output directory (created if missing). |
| `capture.rrweb` | `boolean` | `true` | Record the rrweb session. |
| `capture.network` | `boolean` | `true` | Route failed responses (`status >= 400`) into the console timeline via CDP. |
| `capture.console` | `boolean` | `true` | Capture `console.*` via the rrweb console plugin. Setting this `false` also drops the `[tracelane.net]` network-error lines, since `capture.network` surfaces them through `console.error`. |
| `drainIntervalMs` | `number` | `5000` | Node-side drain poll interval. |
| `cooldownMs` | `number` | `250` | Re-injection cooldown guard (suppresses double-init on hash/HMR navigation). |
| `allure` | `boolean` | `false` | Reserved for the v1.1 Allure shim. No-op in v1. |
| `visualDiff` | `boolean` | `false` | Reserved for the post-MVP visual-diff add-on. No-op in v1. |

The options type is published — `import type { TraceLaneOptions } from '@tracelane/wdio'`.

## Hook-factory alternative (no Service)

For setups that can't register a Service, the **same logic** is available as plain `wdio.conf.ts` hook functions:

```ts
import { traceLaneHooks } from '@tracelane/wdio/hooks';

const tracelane = traceLaneHooks({ mode: 'failed', outDir: './tracelane-reports' });

export const config: Options.Testrunner = {
  // ...
  beforeSession: tracelane.beforeSession,
  before: tracelane.before,
  beforeSuite: tracelane.beforeSuite,
  beforeTest: tracelane.beforeTest,
  beforeCommand: tracelane.beforeCommand, // re-injection on navigation
  afterTest: tracelane.afterTest,
  afterSuite: tracelane.afterSuite,
  after: tracelane.after,
  onComplete: tracelane.onComplete,
};
```

## Network capture

Failed responses (`status >= 400`) are routed into the report's console timeline (prefixed `[tracelane.net]`). This needs `browser.cdp(...)`, which a separate WDIO service provides:

- **WDIO 8:** add `['devtools', {}]` via `@wdio/devtools-service@8`.
- **WDIO 9:** `@wdio/devtools-service` has no stable v9 line (it stabilized at v10); use the v10 service or a CDP-capable session. **If `browser.cdp` is unavailable, `tracelane` degrades gracefully to rrweb + console capture** — the report is still produced, just without the network panel.

Cloud Selenium vendors typically don't expose CDP; rrweb + console capture still work there.

## Supported runners / browsers

| Runner | Status |
|---|---|
| Mocha | **Supported** (primary) |
| Jasmine | Supported (same `afterTest` result shape) |
| Cucumber | Supported via `beforeScenario`/`afterScenario` |

| Browser | rrweb + console | Network (CDP) |
|---|---|---|
| Chrome / Chromium ≥ 116 | **Yes** | Yes (with a CDP-capable session) |
| Edge (Chromium) | Yes | Yes |
| Firefox | Yes | No (CDP is Chromium-only) |
| Safari | Yes | No |

## Playwright + Cypress

The tagline says Playwright and Cypress because the design is portable across runners — same `@tracelane/core` engine, different glue. Tracking issues:

- **`@tracelane/playwright`** — Playwright Reporter implementing `onTestEnd` + `onAttachment` for shareable HTML. Targeted for week 2-3 of the public launch.
- **`@tracelane/cypress`** — JSON-output adapter only (no Cypress Test Replay overlap). Targeted for week 11.

Watch the [release notes](https://github.com/Cubenest/rrweb-stack/releases) on `Cubenest/rrweb-stack` or follow `@cubenest_in` on X (when announced).

## Versioning & telemetry

Semantic Versioning. Currently `0.1.0-alpha.x` (pre-release; the API may shift before `1.0.0`). See [SUPPORTED.md](https://github.com/Cubenest/rrweb-stack/blob/main/SUPPORTED.md) for the compatibility matrix.

**No telemetry.** `tracelane` collects and sends nothing; reports are written to your local `outDir` only. The generated HTML report includes a footer crediting the tool; you can suppress it with `report: { footer: false }` (v1.1+).

## License

Apache 2.0. The bundled rrweb engine + console plugin remain MIT-licensed; see `NOTICE`.

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — sign your commits with `git commit -s`. See [CONTRIBUTING.md](https://github.com/Cubenest/rrweb-stack/blob/main/CONTRIBUTING.md) + [SECURITY.md](https://github.com/Cubenest/rrweb-stack/blob/main/SECURITY.md).
