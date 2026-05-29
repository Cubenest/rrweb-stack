// WDIO config for the @tracelane/wdio smoke test (Task 2.17).
//
// Runs a single Mocha spec that intentionally fails on Chrome; TraceLaneService
// (in `failed` mode) writes a self-contained HTML report. `onComplete` then
// asserts exactly the Phase 2 acceptance criteria: a single `.html` report
// exists in ./tracelane-reports and is < 25 MB.
//
// This config is exercised only by `pnpm --filter @tracelane/wdio test:e2e`,
// never by the default `pnpm test` (which is vitest-only) — so CI's main
// pipeline stays green without Chrome.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@wdio/types';
// Import the Service from source; WDIO loads this TS config via tsx, which also
// transpiles the imported `../src` tree on the fly. The recorder bundle the
// Service reads (`dist/rrweb-bundle.js`) is built by the `test:e2e` script
// before WDIO starts.
import TraceLaneService from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'tracelane-reports');
const fixtureHtml = readFileSync(join(here, 'fixture.html'), 'utf8');

// A tiny static server so the fixture loads over real HTTP (CDP network capture
// needs real requests; the fixture's intentional 404 is served as a 404).
let server: Server | undefined;
let fixtureUrl = '';

const MAX_REPORT_BYTES = 25 * 1024 * 1024;

// CI hand-off (see .github/workflows/ci.yml e2e-wdio job).
//
// WDIO 9's startWebDriver calls setupPuppeteerBrowser + setupChromedriver from
// @wdio/utils, which IGNORE Chrome/chromedriver pre-installed on PATH and
// instead download their own via @puppeteer/browsers into os.tmpdir(). On
// GitHub Actions Ubuntu runners that download can hang silently (no progress
// is logged at warn level), pinning the worker until the 15-min job timeout
// fires — that's the May 29 2026 CI cancellation we saw on every push.
//
// Fix: in CI, browser-actions/setup-chrome installs both binaries and exports
// CHROME_PATH + CHROMEDRIVER_PATH. When those are set we point WDIO directly
// at them via goog:chromeOptions.binary + wdio:chromedriverOptions.binary,
// which short-circuits the Puppeteer download path entirely. Locally the env
// vars are unset and WDIO auto-resolves Chrome from the system as before.
const chromeBinary = process.env.CHROME_PATH || undefined;
const chromedriverBinary = process.env.CHROMEDRIVER_PATH || undefined;

export const config: Options.Testrunner = {
  runner: 'local',
  specs: [join(here, 'test', 'specs', '**', '*.e2e.ts')],
  maxInstances: 1,

  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        ...(chromeBinary ? { binary: chromeBinary } : {}),
        args: [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--remote-debugging-port=0',
        ],
      },
      ...(chromedriverBinary ? { 'wdio:chromedriverOptions': { binary: chromedriverBinary } } : {}),
    },
  ],

  // 'info' (not 'warn'): WDIO 9 logs driver setup at info level — chromedriver
  // download progress, "Using pre-installed chrome v...", driver-start params.
  // Without these lines, a hang in the connect phase produces zero output and
  // is invisible until the job timeout fires. The volume is small (<50 lines
  // for a healthy run) so the noise tradeoff is worth the diagnosability.
  logLevel: 'info',
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  reporters: ['spec'],

  // Network capture (P1 PRD §A.5 / §E.2) needs `browser.cdp(...)`, which in WDIO
  // is provided by `@wdio/devtools-service`. That package has no stable v9
  // release (it stabilized only at v10), so the smoke run leaves it unregistered:
  // TraceLaneService detects the missing `cdp` command and degrades to rrweb +
  // console capture (the report is still produced). When a CDP-capable session is
  // present, add `['devtools', {}]` (v8) or the v10 service here to light up the
  // network panel. `capture.network` stays true so the graceful-degrade path runs.
  services: [
    [
      TraceLaneService,
      {
        mode: 'failed',
        outDir,
        // network: true intentionally exercises the graceful-degrade path (no
        // devtools-service registered) — CDP attach fails once, then capture
        // continues as rrweb + console only.
        capture: { rrweb: true, network: true, console: true },
      },
    ],
  ],

  // Start the fixture server before workers spawn; expose its URL via env so the
  // spec (a separate process) can read it.
  async onPrepare() {
    server = createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(fixtureHtml);
        return;
      }
      // Everything else (incl. the fixture's deliberate fetch) is a 404 — which
      // is exactly what the CDP network-capture path should surface.
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        fixtureUrl = `http://127.0.0.1:${port}/`;
        process.env.TRACELANE_FIXTURE_URL = fixtureUrl;
        resolve();
      });
    });
  },

  // After the run: assert the report acceptance criteria, then stop the server.
  async onComplete() {
    try {
      const files = readdirSync(outDir).filter((f) => f.endsWith('.html'));
      if (files.length === 0) {
        throw new Error(`tracelane smoke: no .html report written to ${outDir}`);
      }
      for (const f of files) {
        const bytes = statSync(join(outDir, f)).size;
        if (bytes >= MAX_REPORT_BYTES) {
          throw new Error(`tracelane smoke: report ${f} is ${bytes} bytes (>= 25 MB budget)`);
        }
        console.log(`tracelane smoke: report OK — ${f} (${bytes} bytes, < 25 MB)`);
      }
    } finally {
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      });
    }
  },
};
