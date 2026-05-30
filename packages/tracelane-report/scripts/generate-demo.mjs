#!/usr/bin/env node
// Generate the public demo report at
// `apps/tracelane-docs/public/demo/acme-shop-checkout-failure.html` from a
// synthetic but realistic event stream + meta. Run via:
//
//   pnpm --filter @tracelane/report build &&
//   node packages/tracelane-report/scripts/generate-demo.mjs
//
// The demo file is what `https://tracelane.cubenest.in/demo` serves: a real
// failing-test report rendered through the canonical build pipeline. Re-runs
// are idempotent; the script overwrites the target HTML in place.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventType } from '@cubenest/rrweb-core';
import { buildReport } from '../dist/build-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const OUT_PATH = join(
  REPO_ROOT,
  'apps',
  'tracelane-docs',
  'public',
  'demo',
  'acme-shop-checkout-failure.html',
);

// ---- Synthetic event stream ----------------------------------------------
//
// Three events so the player has a real timeline. Real recordings ship
// thousands of events; here we just need two timestamps far enough apart that
// the timeline strip + failure marker render meaningfully, plus a couple of
// console + network plugin events for the panels.
//
// The Meta event sets the recorded page's URL + viewport. The FullSnapshot is
// a stub DOM tree the player needs to mount. The plugin events feed the
// panel extraction functions in `panels.ts`.
const T0 = 1735603200000; // 2025-12-31T00:00:00Z — a fixed timestamp for reproducibility
const events = [
  {
    type: EventType.Meta,
    data: {
      href: 'https://shop.example.com/checkout',
      width: 1440,
      height: 900,
    },
    timestamp: T0,
  },
  {
    type: EventType.FullSnapshot,
    data: {
      node: { type: 0, childNodes: [], id: 1 },
      initialOffset: { left: 0, top: 0 },
    },
    timestamp: T0 + 50,
  },
  // Console plugin events — realistic checkout-failure pattern.
  {
    type: EventType.Plugin,
    data: {
      plugin: 'rrweb/console@1',
      payload: { level: 'log', payload: ['"Cart loaded: 2 items, $84.12 total"'] },
    },
    timestamp: T0 + 42_018,
  },
  {
    type: EventType.Plugin,
    data: {
      plugin: 'rrweb/console@1',
      payload: {
        level: 'log',
        payload: ['"Form validation passed: { email: \\"***\\", cardLast4: \\"4242\\" }"'],
      },
    },
    timestamp: T0 + 118_211,
  },
  {
    type: EventType.Plugin,
    data: {
      plugin: 'rrweb/console@1',
      payload: {
        level: 'warn',
        payload: ['"Stripe.js loaded twice on this page — duplicate script tag detected"'],
      },
    },
    timestamp: T0 + 132_450,
  },
  {
    type: EventType.Plugin,
    data: {
      plugin: 'rrweb/console@1',
      payload: {
        level: 'error',
        payload: [
          '"Failed to load resource: the server responded with a status of 500 (Internal Server Error)"',
        ],
      },
    },
    timestamp: T0 + 133_987,
  },
  {
    type: EventType.Plugin,
    data: {
      plugin: 'rrweb/console@1',
      payload: {
        level: 'error',
        payload: [
          '"Uncaught (in promise) Error: Order confirmation request failed\\n    at OrderForm.submit (OrderForm.tsx:84:22)\\n    at HTMLButtonElement.<anonymous> (events.ts:14:9)"',
        ],
      },
    },
    timestamp: T0 + 133_991,
  },
  // Network plugin events — failing requests at the end of the run.
  {
    type: EventType.Plugin,
    data: {
      plugin: 'rrweb/network@1',
      payload: {
        requests: [
          {
            name: 'https://shop.example.com/api/checkout/confirm',
            method: 'POST',
            status: 500,
            timestamp: T0 + 133_900,
            duration: 187,
          },
          {
            name: 'https://shop.example.com/api/cart/restore',
            method: 'POST',
            status: 500,
            timestamp: T0 + 134_500,
            duration: 412,
          },
        ],
      },
    },
    timestamp: T0 + 134_500,
  },
  // A final event so lastTs is the failure moment.
  {
    type: EventType.IncrementalSnapshot,
    data: { source: 2 },
    timestamp: T0 + 134_812,
  },
];

const meta = {
  spec: 'tests/e2e/checkout.e2e.ts',
  title: 'completes checkout with valid card details',
  status: 'failed',
  error:
    'AssertionError: expected element to be visible after 5000ms\n' +
    '  Expected: $(\'[data-test="order-confirmation"]\') to be displayed\n' +
    '  Actual:   element exists in DOM but display: none\n\n' +
    '  at confirmOrder (checkout.e2e.ts:42:14)\n' +
    '  at Context.<anonymous> (checkout.e2e.ts:38:7)',
  durationMs: 134_812,
  browserName: 'chrome',
  browserVersion: '124.0',
  viewport: { width: 1440, height: 900 },
  commitSha: '7f3a892',
  buildUrl: 'https://github.com/Cubenest/rrweb-stack/actions/runs/1284',
};

const html = buildReport(events, meta);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, html, 'utf8');

const sizeKb = (html.length / 1024).toFixed(1);
console.log(`Wrote ${OUT_PATH}`);
console.log(`Size: ${sizeKb} KB (${html.length.toLocaleString('en-US')} bytes)`);
console.log(`Open: file://${OUT_PATH}`);
