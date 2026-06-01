<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/report

> The reporter for your WebdriverIO, Playwright, and Cypress tests. Self-contained HTML for every run — replay failures, audit successes, attach to any bug tracker. No SaaS, no dashboard, no signup.

The self-contained, offline HTML report builder for [`tracelane`](https://github.com/Cubenest/rrweb-stack). Given a captured rrweb event stream plus test metadata, it produces a **single `.html` file** that:

- opens in any browser, fully offline (no network fetch at view time);
- embeds the [`rrweb-player`](https://www.npmjs.com/package/rrweb-player) UMD + CSS inline;
- embeds the events as a gzipped, base64-encoded blob that is decompressed in-page with an inlined [`fflate`](https://github.com/101arrowz/fflate) gunzip;
- renders console + network panels, a metadata header, and a "Copy as Markdown for AI paste" button.

**Not generally intended for direct consumption** — depend on a product package (`@tracelane/wdio`) instead. See the [`@tracelane/wdio` README](https://github.com/Cubenest/rrweb-stack/tree/main/packages/tracelane-wdio) for the integration guide.

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

Apache 2.0. The inlined rrweb player and fflate remain MIT-licensed; see NOTICE.
