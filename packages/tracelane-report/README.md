<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/report

> The HTML report builder behind tracelane — turns a captured rrweb event stream into a single, self-contained `.html` file that replays offline. No SaaS, no dashboard, no signup.

[![npm](https://img.shields.io/npm/v/@tracelane/report.svg)](https://www.npmjs.com/package/@tracelane/report)
[![downloads](https://img.shields.io/npm/dw/@tracelane/report.svg)](https://www.npmjs.com/package/@tracelane/report)
[![license](https://img.shields.io/npm/l/@tracelane/report.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Cubenest/rrweb-stack/badge)](https://scorecard.dev/viewer/?uri=github.com/Cubenest/rrweb-stack)
[![types](https://img.shields.io/npm/types/@tracelane/report.svg)](https://www.npmjs.com/package/@tracelane/report)
[![node](https://img.shields.io/node/v/@tracelane/report.svg)](https://www.npmjs.com/package/@tracelane/report)
![status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

The self-contained, offline HTML report builder for [`tracelane`](https://github.com/Cubenest/rrweb-stack). Given a captured rrweb event stream plus test metadata, it produces a **single `.html` file** that:

- opens in any browser, fully offline (no network fetch at view time);
- embeds the [`rrweb-player`](https://www.npmjs.com/package/rrweb-player) UMD + CSS inline;
- embeds the events as a gzipped, base64-encoded blob that is decompressed in-page with an inlined [`fflate`](https://github.com/101arrowz/fflate) gunzip;
- renders console + network panels, a metadata header, and a "Copy as Markdown for AI paste" button.

**Not generally intended for direct consumption** — depend on a product package (`@tracelane/wdio`) instead. See the [`@tracelane/wdio` README](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) for the integration guide.
## Install

```sh
npm install @tracelane/report
```

- **ESM-only.** The package ships `"type": "module"` and a single `import` export — there is no CommonJS entry, so `require('@tracelane/report')` will not work. Use `import { buildReport } from '@tracelane/report'` (or a dynamic `import()` from CJS).
- **Node >= 22** is required (`engines.node`).

## Usage

```ts
import { buildReport } from '@tracelane/report';

const html = buildReport(events, {
  spec: 'login.spec.ts',
  title: 'logs in with valid credentials',
  status: 'failed',
  error: 'expected element to be visible',
  durationMs: 4210,
  browserName: 'chrome',
  browserVersion: '124.0',
  viewport: { width: 1280, height: 720 },
  // commitSha / buildUrl auto-detected from CI env when omitted
});
// write `html` to ./tracelane-reports/<spec>--<title>.html
```

## Design

- **Player:** `rrweb-player@1.0.0-alpha.4` (upstream). `@posthog/rrweb-player` was the natural lineage match for the `@cubenest/rrweb-core` substrate fork, but every published version pins an unpublished dependency (`@posthog/rrweb-packer@0.0.0`, 404) and is therefore uninstallable. Upstream `rrweb-player` descends from the same rrweb 2.x line (`2.0.0-alpha.x`) that the substrate's `@posthog/rrweb@0.0.34` was forked from (`2.0.0-alpha.17`), so the recorded event shape replays correctly.
- **Decompression:** the build side uses `@cubenest/rrweb-core`'s `compress()` (fflate gzip); the view side inlines fflate's browser `gunzipSync` for a small (~8 KB) offline decompressor.
- **Asset inlining:** the player UMD/CSS and the fflate gunzip source are read from `node_modules` at build time (`fs.readFileSync`) — never hand-pasted into source.

## License

Apache 2.0. The inlined rrweb player and fflate remain MIT-licensed; see [NOTICE](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-report/NOTICE).

## Related packages

- [`@tracelane/cli`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-cli) — wires the recorder into your test runners (WebdriverIO and Playwright; Cypress on the roadmap).
- [`@tracelane/wdio`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) — the WebdriverIO integration that captures sessions and calls this builder on failure.
- [`@tracelane/playwright`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-playwright) — the Playwright integration.
- [`@tracelane/core`](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-core) — the capture engine (rrweb event stream + `compress()`).

See the [CHANGELOG](https://github.com/Cubenest/rrweb-stack/blob/main/packages/tracelane-report/CHANGELOG.md) for release history.
