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
// The Meta event sets the recorded page's URL + viewport. The FullSnapshot is
// a minimal-but-real DOM tree that rrweb-player can actually rebuild + render
// (an empty `childNodes` array crashes rrweb-snapshot's rebuildFullSnapshot
// with `can't access property "insertBefore", e is null`). The plugin events
// feed the panel extraction functions in `panels.ts`.
//
// rrweb NodeType: 0 = Document, 1 = DocumentType, 2 = Element, 3 = Text.
// Every node needs a unique numeric `id`. We hand-roll a small checkout-page
// shell that visually matches the failure scenario described in the meta:
// confirm-order card with a "Place order" button + an error banner.
const T0 = 1735603200000; // 2025-12-31T00:00:00Z — a fixed timestamp for reproducibility

const DEMO_PAGE_CSS = [
  'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;background:#f3f4f6;line-height:1.5}',
  '.container{max-width:540px;margin:64px auto;padding:0 24px}',
  '.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}',
  'h1{font-size:22px;margin:0 0 6px;font-weight:600;color:#111827}',
  'p.lede{color:#6b7280;margin:0 0 24px;font-size:14px}',
  '.row{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #f3f4f6;font-size:14px}',
  '.row:first-of-type{border-top:0}',
  '.row .k{color:#6b7280}',
  '.row .v{color:#111827;font-weight:500}',
  '.total{margin-top:16px;padding-top:16px;border-top:2px solid #e5e7eb;display:flex;justify-content:space-between;font-size:16px;font-weight:600}',
  '.btn{display:block;width:100%;background:#1f2937;color:#fff;border:0;padding:14px;border-radius:8px;font-size:14px;font-weight:600;margin-top:24px;cursor:pointer;font-family:inherit}',
  '.btn:hover{background:#111827}',
  '.err{margin-top:16px;padding:14px;border-radius:8px;background:#fef2f2;border-left:3px solid #dc2626;color:#7f1d1d;font-size:13px;line-height:1.5}',
  '.err strong{color:#991b1b}',
].join('');

const FULL_SNAPSHOT_NODE = {
  type: 0, // Document
  childNodes: [
    { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
    {
      type: 2, // Element <html>
      tagName: 'html',
      attributes: { lang: 'en' },
      childNodes: [
        {
          type: 2, // Element <head>
          tagName: 'head',
          attributes: {},
          childNodes: [
            {
              type: 2,
              tagName: 'meta',
              attributes: { charset: 'utf-8' },
              childNodes: [],
              id: 5,
            },
            {
              type: 2,
              tagName: 'title',
              attributes: {},
              childNodes: [{ type: 3, textContent: 'Checkout — example shop', id: 7 }],
              id: 6,
            },
            {
              type: 2,
              tagName: 'style',
              attributes: {},
              childNodes: [{ type: 3, textContent: DEMO_PAGE_CSS, id: 9 }],
              id: 8,
            },
          ],
          id: 4,
        },
        {
          type: 2, // Element <body>
          tagName: 'body',
          attributes: {},
          childNodes: [
            {
              type: 2,
              tagName: 'div',
              attributes: { class: 'container' },
              childNodes: [
                {
                  type: 2,
                  tagName: 'div',
                  attributes: { class: 'card' },
                  childNodes: [
                    {
                      type: 2,
                      tagName: 'h1',
                      attributes: {},
                      childNodes: [{ type: 3, textContent: 'Confirm your order', id: 14 }],
                      id: 13,
                    },
                    {
                      type: 2,
                      tagName: 'p',
                      attributes: { class: 'lede' },
                      childNodes: [
                        {
                          type: 3,
                          textContent: 'Review and place your order. Your card will be charged once you confirm.',
                          id: 16,
                        },
                      ],
                      id: 15,
                    },
                    {
                      type: 2,
                      tagName: 'div',
                      attributes: { class: 'row' },
                      childNodes: [
                        {
                          type: 2,
                          tagName: 'span',
                          attributes: { class: 'k' },
                          childNodes: [{ type: 3, textContent: 'Wireless earbuds (1)', id: 19 }],
                          id: 18,
                        },
                        {
                          type: 2,
                          tagName: 'span',
                          attributes: { class: 'v' },
                          childNodes: [{ type: 3, textContent: '$59.00', id: 21 }],
                          id: 20,
                        },
                      ],
                      id: 17,
                    },
                    {
                      type: 2,
                      tagName: 'div',
                      attributes: { class: 'row' },
                      childNodes: [
                        {
                          type: 2,
                          tagName: 'span',
                          attributes: { class: 'k' },
                          childNodes: [{ type: 3, textContent: 'Charging dock (1)', id: 24 }],
                          id: 23,
                        },
                        {
                          type: 2,
                          tagName: 'span',
                          attributes: { class: 'v' },
                          childNodes: [{ type: 3, textContent: '$25.12', id: 26 }],
                          id: 25,
                        },
                      ],
                      id: 22,
                    },
                    {
                      type: 2,
                      tagName: 'div',
                      attributes: { class: 'total' },
                      childNodes: [
                        {
                          type: 2,
                          tagName: 'span',
                          attributes: {},
                          childNodes: [{ type: 3, textContent: 'Total', id: 29 }],
                          id: 28,
                        },
                        {
                          type: 2,
                          tagName: 'span',
                          attributes: {},
                          childNodes: [{ type: 3, textContent: '$84.12', id: 31 }],
                          id: 30,
                        },
                      ],
                      id: 27,
                    },
                    {
                      type: 2,
                      tagName: 'button',
                      attributes: { class: 'btn', type: 'button', 'data-test': 'place-order' },
                      childNodes: [{ type: 3, textContent: 'Place order', id: 33 }],
                      id: 32,
                    },
                    // NOTE: the error banner (id 34-37) is intentionally NOT in
                    // the initial snapshot — it's inserted later via a Mutation
                    // event triggered by the click on the Place-order button, so
                    // the replay actually animates instead of being a static frame.
                  ],
                  id: 12,
                },
              ],
              id: 11,
            },
          ],
          id: 10,
        },
      ],
      id: 3,
    },
  ],
  id: 1,
};

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
      node: FULL_SNAPSHOT_NODE,
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
  // ---- User interaction → mutation flow ---------------------------------
  //
  // The replay needs incremental events between the FullSnapshot and the
  // failure for the player to actually animate. Story:
  //   ~1:55  cursor moves toward the Place-order button (MouseMove)
  //   ~1:58  cursor hovers over the button
  //   ~2:13  user clicks (MouseInteraction Click on node id 32)
  //   ~2:14  error banner appears as a child of the .card (Mutation add)
  //
  // IncrementalSource: 0 = Mutation, 1 = MouseMove, 2 = MouseInteraction.
  // MouseInteractions: 2 = Click.

  // Cursor approaches the button. Positions array carries timeOffset relative
  // to the event's timestamp so the player can render smooth interpolation.
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: 1, // MouseMove
      positions: [
        { x: 600, y: 280, id: 12, timeOffset: -800 },
        { x: 560, y: 320, id: 12, timeOffset: -600 },
        { x: 520, y: 360, id: 12, timeOffset: -400 },
        { x: 490, y: 400, id: 32, timeOffset: -200 },
        { x: 480, y: 430, id: 32, timeOffset: 0 },
      ],
    },
    timestamp: T0 + 115_000,
  },
  // User clicks "Place order".
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: 2, // MouseInteraction
      type: 2, // Click
      id: 32, // button node id
      x: 480,
      y: 430,
    },
    timestamp: T0 + 133_500,
  },
  // After the network request fails (the 500 console + network plugin events
  // above), the page inserts the error banner. Mutation `adds` -> a new node
  // appended to the .card (parentId 12), nextId null = append at end.
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: 0, // Mutation
      texts: [],
      attributes: [],
      removes: [],
      adds: [
        {
          parentId: 12,
          nextId: null,
          node: {
            type: 2, // Element
            tagName: 'div',
            attributes: { class: 'err', 'data-test': 'error' },
            childNodes: [
              {
                type: 2,
                tagName: 'strong',
                attributes: {},
                childNodes: [
                  { type: 3, textContent: 'Order could not be confirmed.', id: 36 },
                ],
                id: 35,
              },
              {
                type: 3,
                textContent:
                  ' The server returned an internal error (500). Please try again in a moment.',
                id: 37,
              },
            ],
            id: 34,
          },
        },
      ],
    },
    timestamp: T0 + 134_500,
  },
  // Trailing event so lastTs is exactly the failure moment (drives the
  // timeline-strip's amber marker position).
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: 1, // MouseMove — single stationary frame after the failure
      positions: [{ x: 480, y: 430, id: 34, timeOffset: 0 }],
    },
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
