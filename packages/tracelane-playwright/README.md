<img src="https://raw.githubusercontent.com/Cubenest/rrweb-stack/main/assets/brand/sub-tracelane.svg" height="40" alt="tracelane">

# @tracelane/playwright

> The recorder for your Playwright tests. A self-contained HTML report on every failure — replay the run with rrweb, inspect the console + failed-network panels, attach to any bug tracker. No SaaS, no dashboard, no signup, no cloud.

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

Run your suite. On a failing test you get a single `.html` file at `./tracelane-reports/<spec>--<title>--<project>-<ts>.html` — open it in any browser, fully offline. Replay the run with [rrweb-player](https://www.rrweb.io), inspect the console + failed-network panels, attach to your bug tracker, archive it forever.

## How it works

- **The fixture** owns the recording. It is the only place with a live `page` + `testInfo`, so it injects the rrweb bundle via `context.addInitScript` AND hooks `page.on('framenavigated')` to call `recorder.reinject` on every main-frame navigation — so recording continues across navigations (each navigation emits a `tracelane.nav` boundary marker in the replay). It starts the recorder before your test body, and — after it — builds + writes the report. It reuses `@tracelane/core`'s recorder and `@tracelane/report`'s HTML builder.
- **The reporter** owns config only: it validates options at startup and bridges them to the fixture via `TRACELANE_*` env vars. By design it never touches `page`, prints nothing, and produces no end-of-run summary (the fixture writes the per-test reports).
- **Failed-network capture** uses CDP on Chromium (4xx/5xx responses and no-response failures are surfaced into the report's network panel). On Firefox/WebKit it degrades silently to rrweb + console.
- **Parallel-safe**: report filenames are namespaced by the Playwright **project name** and carry a millisecond timestamp. Different projects are isolated by name; parallel workers *within one project* share the project-name segment and rely on the timestamp (plus spec + title) to stay distinct.
- **Coexists** with Playwright's own `trace` — keep `trace: 'on-first-retry'` if you like; tracelane writes a separate, self-contained artifact.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `mode` | `'failed'` | `'failed'` writes a report only on failure; `'all'` writes one for every test. Overridable with `TRACELANE_MODE`. |
| `outDir` | `'./tracelane-reports'` | Where reports are written. Overridable with `TRACELANE_OUT_DIR`. |
| `captureNetwork` | `true` | CDP failed-network capture (Chromium-only). Overridable with `TRACELANE_CAPTURE_NETWORK`. |

> Reporter options (`mode`, `outDir`, `captureNetwork`) are honored by the fixture — the reporter bridges them to `TRACELANE_MODE` / `TRACELANE_OUT_DIR` / `TRACELANE_CAPTURE_NETWORK` at startup (only when those env vars are not already set). An explicit env var always wins over the reporter option.

## What this is NOT

- Not a SaaS. There is no upload, no signup, no dashboard, no telemetry. The artifact is a single HTML file on your filesystem.
- Not a replacement for Playwright's trace viewer — it's a complementary, self-contained replay you can hand to anyone with a browser, no `npx playwright show-trace` required.

## Limitations

**Content-Security-Policy**: rrweb capture requires in-page script evaluation. If a page's CSP blocks `'unsafe-eval'`, capture degrades gracefully — the test still runs and completes normally, a warning is logged, but no replay is recorded for that page.

**Cross-origin navigations**: buffered rrweb events are rescued across same-origin hard navigations via a `pagehide` → `sessionStorage` flush. Cross-origin hard navigations are a known edge case — `sessionStorage` is per-origin, so events buffered immediately before a cross-origin navigation may be lost.

## License

Apache-2.0. See [`NOTICE`](./NOTICE) for bundled third-party software (the rrweb fork + console plugin).
