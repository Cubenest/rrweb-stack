// Reproducible generator for the security-hygiene advisory demo report.
// Run: pnpm --filter @tracelane/security build && pnpm --filter @tracelane/report build \
//      && node packages/docs-shared/scripts/gen-security-demo.mjs
// Writes apps/tracelane-docs/public/demo/security-hygiene-advisory.html (committed).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventType } from '@cubenest/rrweb-core';
import { buildReport } from '@tracelane/report';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(REPO, 'apps/tracelane-docs/public/demo/security-hygiene-advisory.html');

function secEvent(meta) {
  return {
    type: EventType.Plugin,
    timestamp: 0,
    data: {
      plugin: 'rrweb/console@1',
      payload: {
        level: 'error',
        payload: [JSON.stringify(`[tracelane.sec] ${JSON.stringify(meta)}`)],
      },
    },
  };
}
const mainDocMeta = {
  url: 'https://shop.example/checkout',
  status: 200,
  isMainDocument: true,
  presentSecurityHeaders: [],
  setCookies: [{ name: 'session', secure: false, httpOnly: false, sameSite: false }],
};
const el = (tagName, attributes, id, childNodes = []) => ({
  type: 2,
  tagName,
  attributes,
  childNodes,
  id,
});
const fullSnapshot = {
  type: EventType.FullSnapshot,
  timestamp: 200,
  data: {
    initialOffset: {},
    node: {
      type: 0,
      id: 1,
      childNodes: [
        el('html', {}, 2, [
          el('body', {}, 3, [
            el('img', { src: 'http://insecure-cdn.example/pixel.gif' }, 4),
            el('a', { target: '_blank', href: 'https://partner.example/promo' }, 5),
            el('link', { rel: 'canonical', href: 'http://shop.example/canonical' }, 6),
          ]),
        ]),
      ],
    },
  },
};
const events = [
  {
    type: EventType.Meta,
    data: { href: 'https://shop.example/checkout', width: 1280, height: 720 },
    timestamp: 100,
  },
  fullSnapshot,
  secEvent(mainDocMeta),
];
const meta = {
  spec: 'e2e/checkout.spec.ts',
  title: 'completes checkout with a saved card',
  status: 'failed',
  error: 'expected order confirmation to be visible',
  durationMs: 5120,
  browserName: 'chrome',
  browserVersion: '124.0',
  viewport: { width: 1280, height: 720 },
};
const html = buildReport(events, meta);
if (!html.includes('id="pane-security"'))
  throw new Error(
    'generator: security panel missing — build @tracelane/security + @tracelane/report first',
  );
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB)`);
