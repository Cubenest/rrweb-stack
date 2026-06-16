// peek in-page action-feedback E2E.
//
// The unit suite (action-feedback.test.ts) runs over jsdom, which has no real
// closed-shadow semantics, no real layout (getBoundingClientRect), no real CSS
// engine, and stubbed timers. This spec exercises the SAME injected functions
// (`showElementFeedback` / `showPageToast`) in REAL Chromium via
// `page.evaluate(fn, args)` — which serializes the function into the page's
// main world exactly as `chrome.scripting.executeScript({ world:'MAIN', func })`
// does in the service worker — and asserts the three real-browser invariants
// that can't be observed in jsdom:
//
//   1. The cue renders without throwing (real DOM/CSS/serialization round-trip).
//   2. The host uses a genuine CLOSED shadow root (`host.shadowRoot === null`),
//      so rrweb cannot serialize the cue subtree, AND the host is
//      `display:contents` (no layout box), so blocking its `data-peek-fx`
//      marker leaves no placeholder rectangle on replay. (Marker ∈
//      RECORDER_BLOCK_SELECTOR is covered by shield-recorder-invisibility.test.)
//   3. The cue SELF-REMOVES on the real timer (~900 ms element, ~2200 ms toast).
//
// Run with: pnpm --filter @peekdev/extension build && pnpm --filter @peekdev/extension test:e2e

import { expect, test } from '@playwright/test';
import {
  FEEDBACK_CSS,
  showElementFeedback,
  showPageToast,
} from '../src/permissions/action-feedback';
import { launchExtension } from './_harness';

const HOST = 'data-peek-fx';

test.describe('in-page action feedback (real browser)', () => {
  test('element cue: real closed-shadow host appears, then self-removes', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      // An off-screen-ish input + a button. about:blank content → the extension's
      // http(s)-only relay does not inject, so the page is clean.
      await page.setContent(
        '<input id="i" style="position:absolute;top:40px;left:10px"><button id="b">go</button>',
      );

      // Run the EXACT production function in the page's main world.
      const res = await page.evaluate(showElementFeedback, {
        verb: 'type',
        selector: '#i',
        hostAttr: HOST,
        css: FEEDBACK_CSS,
      });
      expect(res).toEqual({ ok: true });

      // Real-browser invariants: present, CLOSED shadow (inaccessible),
      // display:contents (no layout box → no rr-block placeholder).
      const probe = await page.evaluate((hostAttr) => {
        const h = document.documentElement.querySelector(`[${hostAttr}]`) as HTMLElement | null;
        if (!h) return { present: false, shadowNull: false, display: '' };
        return {
          present: true,
          shadowNull: h.shadowRoot === null,
          display: getComputedStyle(h).display,
        };
      }, HOST);
      expect(probe.present, 'cue host appended to the page').toBe(true);
      expect(probe.shadowNull, 'closed shadow root — rrweb cannot serialize it').toBe(true);
      expect(probe.display, 'display:contents — host has no layout box').toBe('contents');

      // Self-removes on the real ~900 ms timer.
      await expect.poll(() => page.locator(`[${HOST}]`).count(), { timeout: 4000 }).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('page toast: real closed-shadow toast appears, then self-removes', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.setContent('<p>destination</p>');

      const res = await page.evaluate(showPageToast, {
        verb: 'navigate',
        detail: 'example.com',
        hostAttr: HOST,
        css: FEEDBACK_CSS,
      });
      expect(res).toEqual({ ok: true });

      const probe = await page.evaluate((hostAttr) => {
        const h = document.documentElement.querySelector(`[${hostAttr}]`) as HTMLElement | null;
        return h
          ? { present: true, shadowNull: h.shadowRoot === null }
          : { present: false, shadowNull: false };
      }, HOST);
      expect(probe.present, 'toast host appended to the page').toBe(true);
      expect(probe.shadowNull, 'closed shadow root — rrweb cannot serialize it').toBe(true);

      // Self-removes on the real ~2200 ms timer.
      await expect.poll(() => page.locator(`[${HOST}]`).count(), { timeout: 4000 }).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('element cue: missing selector is a best-effort no-op (no host, no throw)', async () => {
    const { context } = await launchExtension();
    try {
      const page = await context.newPage();
      await page.setContent('<button id="b">go</button>');

      const res = await page.evaluate(showElementFeedback, {
        verb: 'click',
        selector: '#does-not-exist',
        hostAttr: HOST,
        css: FEEDBACK_CSS,
      });
      expect(res).toEqual({ ok: true });
      expect(
        await page.locator(`[${HOST}]`).count(),
        'no cue host created for a missing target',
      ).toBe(0);
    } finally {
      await context.close();
    }
  });
});
