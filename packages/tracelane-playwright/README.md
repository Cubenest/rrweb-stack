<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/playwright

> The recorder for your Playwright tests. When a test fails, you get **one HTML file you can email** — media inlined, so it replays the whole session like a video the moment someone double-clicks it. No server, no unzip, no `show-trace`, no toolchain. Under the hood it's rrweb **continuous** DOM replay (not discrete snapshots) across every navigation, plus the console and failed-network panels. Apache-2.0. No SaaS, no dashboard, no signup, no cloud.

**Why one file matters.** A `trace.zip` can't be double-clicked — it needs `npx playwright show-trace` or the hosted web viewer over `http(s)://`. The built-in HTML reporter is a server-served folder (`show-report`); open it over `file://` and you get a blank screen. tracelane's artifact is a single `.html` with **all media inlined** — drop it in a bug ticket, email it, archive it, and it still replays standalone. (Plenty of reporters write "a single HTML file"; the part that's specific here is the fully-inlined media *plus* rrweb continuous session replay, so the file plays back like a screen recording with no dependencies.)

[![npm](https://img.shields.io/npm/v/@tracelane/playwright.svg)](https://www.npmjs.com/package/@tracelane/playwright)
[![downloads](https://img.shields.io/npm/dw/@tracelane/playwright.svg)](https://www.npmjs.com/package/@tracelane/playwright)
[![license](https://img.shields.io/npm/l/@tracelane/playwright.svg)](https://github.com/Cubenest/rrweb-stack/blob/main/LICENSE)
[![CI](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Cubenest/rrweb-stack/actions/workflows/ci.yml)

Docs: <https://tracelane.cubenest.in>

## Install

```sh
npm install --save-dev @tracelane/playwright
```

`@playwright/test` (>= 1.40) is a peer dependency — you already have it.

## Wire it (two edits)

**1. Register the reporter** in `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['@tracelane/playwright', { mode: 'failed', outDir: './tracelane-reports' }],
  ],
});
```

**2. Use tracelane's `test`/`expect`** in your specs (a drop-in for `@playwright/test`):

```ts
import { test, expect } from '@tracelane/playwright/fixture';

test('checkout', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByRole('heading')).toHaveText('Order complete');
});
```

That's it. The fixture is `auto` — every test in files that import this `test` is recorded; nothing else to wire per-test.

Run your suite. On a failing test you get one `.html` file at `./tracelane-reports/<spec>--<title>--<project>-<ts>.html`. Double-click it — it opens in any browser, fully offline, with every asset inlined (nothing fetched, nothing to unzip, no local server). Scrub the run as a [rrweb](https://www.rrweb.io) continuous DOM replay, inspect the console + failed-network panels, drop it into a bug ticket, archive it forever.

## How it works

- **The fixture** owns the recording — and keeps it going across navigations, so the replay is one continuous session, not a set of per-page snapshots. It is the only place with a live `page` + `testInfo`, so it injects the rrweb bundle via `context.addInitScript` AND hooks `page.on('framenavigated')` to call `recorder.reinject` on every main-frame navigation (each navigation emits a `tracelane.nav` boundary marker in the replay). It starts the recorder before your test body, and — after it — builds + writes the report. It reuses `@tracelane/core`'s recorder and `@tracelane/report`'s HTML builder.
- **The reporter** owns config only: it validates options at startup and bridges them to the fixture via `TRACELANE_*` env vars. By design it never touches `page`, prints nothing, and produces no end-of-run summary (the fixture writes the per-test reports).
- **Network capture** is captured **in-page** by the framework-agnostic `rrweb/network@1` plugin — it works on **every browser** (Chromium, Firefox, WebKit) with no CDP, because it wraps `fetch`/`XHR` and reads `PerformanceObserver` entries from inside the page. Privacy-first: only URL/method/status/timing (headers + bodies off). On **Chromium** tracelane *additionally* uses CDP to enrich the panel with authoritative HTTP status for failed responses (`4xx`/`5xx`) and true no-response failures (CORS/DNS/offline/abort); the report merges the CDP rows over the in-page rows for the same request (real status wins). Off entirely when `captureNetwork` is `false`.
- **Parallel-safe**: report filenames are namespaced by the Playwright **project name** and carry a millisecond timestamp. Different projects are isolated by name; parallel workers *within one project* share the project-name segment and rely on the timestamp (plus spec + title) to stay distinct.
- **Coexists** with Playwright's own `trace` — keep `trace: 'on-first-retry'` if you like; tracelane writes a separate, self-contained artifact.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `mode` | `'failed'` | `'failed'` writes a report only on failure; `'all'` writes one for every test. Overridable with `TRACELANE_MODE`. |
| `outDir` | `'./tracelane-reports'` | Where reports are written. Overridable with `TRACELANE_OUT_DIR`. |
| `captureNetwork` | `true` | Network capture: the in-page `rrweb/network@1` plugin on **all browsers**, plus CDP enrichment (authoritative status + no-response failures) on Chromium. Overridable with `TRACELANE_CAPTURE_NETWORK`. |

> Reporter options (`mode`, `outDir`, `captureNetwork`) are honored by the fixture — the reporter bridges them to `TRACELANE_MODE` / `TRACELANE_OUT_DIR` / `TRACELANE_CAPTURE_NETWORK` at startup (only when those env vars are not already set). An explicit env var always wins over the reporter option.

## What this is NOT

- Not a SaaS. There is no upload, no signup, no dashboard, no telemetry. The artifact is a single HTML file on your filesystem — and unlike reporters that link screenshots/video by relative path, every asset is inlined, so the file keeps replaying even when it's moved or emailed on its own.
- Not a replacement for Playwright's trace viewer. The trace viewer is the deeper local-debugging tool; tracelane is for the *handoff* — a double-clickable `file://` replay (media inlined, no local server, no `show-trace`/`show-report` step) you can hand to anyone with a browser. The capture model differs too: Playwright records discrete per-action snapshots, tracelane records a continuous rrweb session.

## Limitations

**Content-Security-Policy**: rrweb capture requires in-page script evaluation. If a page's CSP blocks `'unsafe-eval'`, capture degrades gracefully — the test still runs and completes normally, a warning is logged, but no replay is recorded for that page.

**Cross-origin navigations**: buffered rrweb events are rescued across same-origin hard navigations via a `pagehide` → `sessionStorage` flush. Cross-origin hard navigations are a known edge case — `sessionStorage` is per-origin, so events buffered immediately before a cross-origin navigation may be lost.

## License

Apache-2.0. See [`NOTICE`](./NOTICE) for bundled third-party software (the rrweb fork + console plugin).
