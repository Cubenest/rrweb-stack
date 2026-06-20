// peek live page-view (R1 ref-tagged snapshot + R2 stable refs / element detail /
// observe delta) E2E.
//
// The unit suite (snapshot.test.ts) runs over jsdom: no real layout
// (getBoundingClientRect), no real CSS engine, no real MAIN-world script
// context, and `eval`/`new Function` are never CSP-gated there. This spec
// exercises the SAME injected functions (`buildPageView`,
// `diffPageViewStandalone`, `buildElementDetail`) in REAL Chromium via
// `page.evaluate(fn, args)`, which serializes the function into the page just
// like the service worker's `chrome.scripting.executeScript({ world:'MAIN',
// func })` does (both go through `Function.prototype.toString`). It asserts the
// load-bearing R2 invariants jsdom cannot observe:
//
//   1. ref STABILITY across two snapshots in a real document (an element keeps
//      its ref; a newly-appended element gets a fresh higher e{N}).
//   2. in-page MASKING under a real CSS/layout engine (a real
//      `<input type=password>` value → `•••`, never the cleartext).
//   3. CSP-SAFE injection: `diffPageViewStandalone` runs and returns a delta on
//      a page served with a STRICT `script-src 'self'` (no `'unsafe-eval'`) CSP.
//      See the note on the test for why the source-level no-eval guarantee is
//      the load-bearing proof and the functional run is corroborating.
//   4. rrweb-INVISIBILITY: the registry lives ONLY in JS `window` globals
//      (`__peekRefs` / `__peekRefByEl` / `__peekLastView`), with NO matching DOM
//      attribute or element — so rrweb never serializes it. Mirrors how
//      action-feedback.spec proves its closed-shadow host isn't captured.
//   5. element_detail returns structured detail and NEVER exposes
//      `outerHTML`/`innerHTML`.
//
// Run with: pnpm --filter @peekdev/extension build && \
//           pnpm --filter @peekdev/extension test:e2e -- page-view.spec.ts

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import {
  buildElementDetail,
  buildPageView,
  diffPageViewStandalone,
} from '../src/permissions/snapshot';
import { launchExtension } from './_harness';

const here = dirname(fileURLToPath(import.meta.url));
const pageViewHtml = readFileSync(resolve(here, 'fixtures', 'page-view.html'), 'utf8');
const strictCspHtml = readFileSync(resolve(here, 'fixtures', 'strict-csp.html'), 'utf8');

// Serve a fixture over a real https origin (via page.route) so the browser
// parses the document — and any <meta http-equiv="Content-Security-Policy"> in
// it — exactly as a live site would. (about:blank / setContent do not reliably
// apply a meta CSP.)
const ORIGIN = 'https://peek-page-view.test';

test.describe('live page view — stable refs / masking / detail (real browser)', () => {
  test('ref STABILITY: same element keeps its ref; a new element gets a fresh higher e{N}', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route(`${ORIGIN}/**`, (r) =>
        r.fulfill({ contentType: 'text/html', body: pageViewHtml }),
      );
      await page.goto(`${ORIGIN}/`);

      // First snapshot — runs the EXACT production walker in the page's main world.
      const first = await page.evaluate(buildPageView, {});
      const delRef = first.nodes.find((n) => n.name === 'Delete This Repository')?.ref;
      const settingsRef = first.nodes.find((n) => n.name === 'Settings')?.ref;
      expect(delRef, 'delete button has a ref').toBeDefined();
      expect(settingsRef, 'settings link has a ref').toBeDefined();

      const seqBefore = await page.evaluate(
        () => (window as unknown as { __peekRefSeq?: number }).__peekRefSeq ?? 0,
      );

      // Mutate the live DOM: append a brand-new interactive element.
      await page.evaluate(() => {
        const b = document.createElement('button');
        b.id = 'fresh';
        b.textContent = 'Newly Added';
        document.getElementById('late')?.appendChild(b);
      });

      // Second snapshot.
      const second = await page.evaluate(buildPageView, {});
      expect(
        second.nodes.find((n) => n.name === 'Delete This Repository')?.ref,
        'surviving element keeps the SAME ref across snapshots',
      ).toBe(delRef);
      expect(second.nodes.find((n) => n.name === 'Settings')?.ref).toBe(settingsRef);

      const newRef = second.nodes.find((n) => n.name === 'Newly Added')?.ref;
      expect(newRef, 'new element got a ref').toBeDefined();
      const newNum = Number((newRef ?? 'e0').slice(1));
      expect(newNum, 'new element gets a fresh higher e{N}').toBeGreaterThan(seqBefore);
    } finally {
      await context.close();
    }
  });

  test('in-page MASKING: a real password input value is •••, never the cleartext', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route(`${ORIGIN}/**`, (r) =>
        r.fulfill({ contentType: 'text/html', body: pageViewHtml }),
      );
      await page.goto(`${ORIGIN}/`);

      const view = await page.evaluate(buildPageView, {});

      // The password field's node value is the placeholder, and the cleartext
      // appears NOWHERE in the serialized view.
      const pw = view.nodes.find((n) => n.role === 'textbox' && n.value === '•••');
      expect(pw, 'password node value is the •••  placeholder').toBeDefined();
      expect(JSON.stringify(view), 'cleartext password never leaves the page').not.toContain(
        'hunter2',
      );
      // A non-sensitive free-text input keeps its (clipped) value — consistent
      // with peek's recorder (free-text values may be returned).
      expect(view.nodes.find((n) => n.name === 'Repository description')?.value).toBe('Archived');
    } finally {
      await context.close();
    }
  });

  test('CSP-SAFE injection: diffPageViewStandalone runs + returns a delta under a strict script-src CSP', async () => {
    // LOAD-BEARING proof of the no-eval requirement.
    //
    // The canonical guarantee is the SOURCE-LEVEL one (asserted at the bottom of
    // this test and in snapshot.test.ts): `diffPageViewStandalone` nests its
    // walker as a real inner function — it contains no `eval(` / `new Function`,
    // so the service worker can `executeScript({ world:'MAIN', func })` it on any
    // site whose CSP omits `'unsafe-eval'`. An `eval`-based reconstruction would
    // throw under such a CSP and silently break the diff on most hardened sites.
    //
    // We ALSO run it functionally on a page served with a strict
    // `script-src 'self'` (no `'unsafe-eval'`) CSP. Caveat documented honestly:
    // Playwright's `page.evaluate` injects through the DevTools protocol, whose
    // execution context is NOT subject to the page's `script-src` the way the
    // SW's `executeScript({ world:'MAIN' })` is. A probe of `eval` inside
    // `page.evaluate` therefore is NOT blocked by the meta CSP (verified: it
    // returns a value rather than throwing), which is exactly why this functional
    // run cannot itself prove the eval-free property — only that the function
    // executes correctly on a strict-CSP DOM. The source-token assertion below is
    // the load-bearing proof of the no-eval requirement.
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route(`${ORIGIN}/**`, (r) =>
        r.fulfill({ contentType: 'text/html', body: strictCspHtml }),
      );
      await page.goto(`${ORIGIN}/`);

      // Confirm the strict CSP IS present in the served document (a true,
      // checkable fact — the <meta http-equiv> the browser parsed). We do NOT
      // assert it blocks `page.evaluate` eval (it can't; see the note above).
      const cspMeta = await page.evaluate(
        () =>
          document
            .querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') ?? '',
      );
      expect(cspMeta, 'fixture is served with a strict script-src CSP').toContain(
        "script-src 'self'",
      );
      expect(cspMeta, 'CSP has no unsafe-eval').not.toContain('unsafe-eval');

      // Prime the registry (diff compares against window.__peekLastView), then
      // mutate, then diff — all via the standalone, eval-free walker.
      await page.evaluate(buildPageView, {});
      await page.evaluate(() => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Discard';
        document.querySelector('main')?.appendChild(b);
      });
      const delta = await page.evaluate(diffPageViewStandalone, {});

      expect(delta.url, 'delta carries the page url').toContain(ORIGIN);
      expect(
        delta.added.some((n) => n.name === 'Discard'),
        'the newly-added button shows up in the delta on a strict-CSP page',
      ).toBe(true);

      // Source-level guarantee: no runtime code generation anywhere in the
      // injected source (this is what actually makes it CSP-safe).
      const src = diffPageViewStandalone.toString();
      expect(src, 'no new Function in the injected source').not.toMatch(/new\s+Function\s*\(/);
      expect(src, 'no eval( in the injected source').not.toMatch(/\beval\s*\(/);
    } finally {
      await context.close();
    }
  });

  test('rrweb-INVISIBILITY: registry lives only in JS globals, with NO DOM attribute/element', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route(`${ORIGIN}/**`, (r) =>
        r.fulfill({ contentType: 'text/html', body: pageViewHtml }),
      );
      await page.goto(`${ORIGIN}/`);

      await page.evaluate(buildPageView, {});

      const probe = await page.evaluate(() => {
        const w = window as unknown as {
          __peekRefs?: unknown;
          __peekRefByEl?: unknown;
          __peekLastView?: unknown;
          __peekRefSeq?: unknown;
        };
        // A data-peek-ref attribute would be serialized by rrweb — there must be
        // none. Also assert no element carries any peek registry marker attr.
        const refAttrEls = document.querySelectorAll(
          '[data-peek-ref],[data-peekref],[__peekrefs],[data-peek-refs]',
        ).length;
        let anyPeekAttr = false;
        for (const el of Array.from(document.querySelectorAll('*'))) {
          for (const a of Array.from(el.attributes)) {
            if (
              a.name.toLowerCase().includes('peekref') ||
              a.name.toLowerCase().includes('peek-ref')
            ) {
              anyPeekAttr = true;
            }
          }
        }
        return {
          refsIsMap: w.__peekRefs instanceof Map,
          byElIsWeakMap: w.__peekRefByEl instanceof WeakMap,
          lastViewIsArray: Array.isArray(w.__peekLastView),
          seqIsNumber: typeof w.__peekRefSeq === 'number',
          refAttrEls,
          anyPeekAttr,
        };
      });

      // The registry exists as JS globals…
      expect(probe.refsIsMap, '__peekRefs is a JS Map global').toBe(true);
      expect(probe.byElIsWeakMap, '__peekRefByEl is a JS WeakMap global').toBe(true);
      expect(probe.lastViewIsArray, '__peekLastView is a JS array global').toBe(true);
      expect(probe.seqIsNumber, '__peekRefSeq is a JS number global').toBe(true);
      // …but NOTHING was written to the DOM (so rrweb cannot record it).
      expect(probe.refAttrEls, 'no element carries a data-peek-ref attribute').toBe(0);
      expect(probe.anyPeekAttr, 'no element carries any peek-ref-ish attribute').toBe(false);
    } finally {
      await context.close();
    }
  });

  test('element_detail: returns structured detail and NEVER exposes outerHTML/innerHTML', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.route(`${ORIGIN}/**`, (r) =>
        r.fulfill({ contentType: 'text/html', body: pageViewHtml }),
      );
      await page.goto(`${ORIGIN}/`);

      // Snapshot first so the ref registry is populated, then resolve the delete
      // button's ref and drill in.
      const view = await page.evaluate(buildPageView, {});
      const delRef = view.nodes.find((n) => n.name === 'Delete This Repository')?.ref;
      expect(delRef, 'delete button ref resolved from the snapshot').toBeDefined();

      const detail = await page.evaluate(buildElementDetail, delRef ?? 'e0');
      expect(detail.ok, 'detail resolved').toBe(true);
      if (detail.ok) {
        expect(detail.tag).toBe('button');
        expect(detail.role).toBe('button');
        expect(detail.name).toBe('Delete This Repository');
        // Lossless structured fields present.
        expect(detail.rect).toHaveProperty('w');
        expect(Array.isArray(detail.state)).toBe(true);
        expect(typeof detail.aria).toBe('object');
        // nearby heading from the real document.
        expect(detail.context?.heading).toBe('Repository settings');
      }

      // The result must carry NO raw-HTML keys (would bypass masking).
      const keys = Object.keys(detail);
      expect(keys, 'no outerHTML key').not.toContain('outerHTML');
      expect(keys, 'no innerHTML key').not.toContain('innerHTML');
      expect(JSON.stringify(detail).toLowerCase(), 'no html key anywhere in payload').not.toContain(
        'outerhtml',
      );

      // A masked drill-in of the password field never leaks the cleartext.
      const pwView = await page.evaluate(buildPageView, {});
      const pwRef = pwView.nodes.find((n) => n.value === '•••')?.ref;
      if (pwRef) {
        const pwDetail = await page.evaluate(buildElementDetail, pwRef);
        expect(JSON.stringify(pwDetail), 'password cleartext never in detail').not.toContain(
          'hunter2',
        );
      }
    } finally {
      await context.close();
    }
  });
});
