// QA fixture WDIO config — drives passing.spec.ts and failing.spec.ts against
// a tiny static server on 127.0.0.1:<random>. Mirrors the in-repo smoke test
// (packages/tracelane-wdio/e2e/wdio.conf.ts) but is decoupled from monorepo
// internals — it depends ONLY on published @tracelane/* alphas, so it
// validates the install-and-run path a real user takes.

import { readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import TraceLaneService from '@tracelane/wdio';
import type { Options } from '@wdio/types';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'tracelane-reports');
const fixtureHtml = readFileSync(join(here, 'page-fixture.html'), 'utf8');

let server: Server | undefined;

export const config: Options.Testrunner = {
  runner: 'local',
  specs: [join(here, 'tests', '**', '*.spec.ts')],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--remote-debugging-port=0',
        ],
      },
    },
  ],
  logLevel: 'warn',
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  reporters: ['spec'],
  services: [
    [
      TraceLaneService,
      {
        // Default ADR-0005 behavior — only failures yield a report.
        mode: 'failed',
        outDir,
        capture: { rrweb: true, network: true, console: true },
      },
    ],
  ],
  async onPrepare() {
    server = createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(fixtureHtml);
        return;
      }
      // Anything else (incl. the fixture's deliberate `/api/will-fail`) is a 404.
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', () => {
        const addr = server?.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        process.env.TRACELANE_DEMO_URL = `http://127.0.0.1:${port}/`;
        resolve();
      });
    });
  },
  async onComplete() {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
  },
};
