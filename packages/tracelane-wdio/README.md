# @tracelane/wdio

A [WebdriverIO](https://webdriver.io) **Service** that records an [rrweb](https://www.rrweb.io)-grade session of your test run and, on a failed test, writes a **single self-contained `.html` report** to `./tracelane-reports/` — replay, console panel, and failed-network panel, all offline in one file.

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

Run your suite. On a failing Chrome+Mocha test you get `./tracelane-reports/<spec>--<title>--<cid>-<ts>.html` — open it in any browser, fully offline.

## Install

```sh
pnpm add -D @tracelane/wdio webdriverio @wdio/cli @wdio/local-runner @wdio/mocha-framework
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

For setups that can't register a Service, the **same logic** is available as plain `wdio.conf.ts` hook functions ([ADR-0004](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0004-p1-wdio-service-not-reporter.md)):

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

## FAQ — Why is this a Service and not a Reporter?

Because only a **Service** can do what `tracelane` needs ([ADR-0004](https://github.com/Cubenest/rrweb-stack/blob/main/prds/adrs/0004-p1-wdio-service-not-reporter.md)):

| | Service (`Services.ServiceInstance`) | Reporter (`@wdio/reporter`) |
|---|---|---|
| Access to live `browser` in worker hooks | **Yes** | No — reporters run in the launcher process |
| `browser.execute(...)` to inject rrweb / drain the buffer | **Yes** | No |
| `browser.cdp(...)` for network capture | **Yes** | No |

A Reporter receives only serialized lifecycle events (`testFail`, `testEnd`, …) in the launcher process — it has no page handle, so it can't inject rrweb, drain the in-page buffer, or attach CDP. (`wdio-allure-reporter` hit exactly this wall and had to add a runtime-side `addAttachment` helper to bridge browser access.) A paired Allure **Reporter** shim is planned for v1.1 to push `tracelane` artifacts into Allure's `addAttachment` API — that's a Reporter-shaped problem; capture is not.

## Network capture

Failed responses (`status >= 400`) are routed into the report's console timeline (prefixed `[tracelane.net]`, [P1 PRD §E.2](https://github.com/Cubenest/rrweb-stack/blob/main/prds/compass_artifact_wf-d53d32da-17e9-41b5-bb70-21dd1bf648c6_text_markdown.md)). This needs `browser.cdp(...)`, which a separate WDIO service provides:

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

## Versioning

Semantic Versioning. Currently `0.1.0-alpha.0` (pre-release; the API may shift before `1.0.0`).

## Telemetry

None. `tracelane` collects and sends nothing; reports are written to your local `outDir` only.

## License

Apache 2.0. The bundled rrweb engine + console plugin remain MIT-licensed; see `NOTICE`.

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — sign your commits with `git commit -s`.
