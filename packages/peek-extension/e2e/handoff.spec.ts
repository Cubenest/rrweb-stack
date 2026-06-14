// peek input-handoff E2E (Plan B, Task 9).
//
// Builds on the Plan A control-shield E2E (shield.spec.ts) and reuses the same
// harness. Plan B adds the input-handoff sub-state: while the Level-4 control
// shield is up, the agent can pause and hand the keyboard back to the user for
// one editable field (or a free-text prompt), then resume (`shield.resume`).
//
// Two paths, mirroring shield.spec.ts:
//
//   1. VIEW-DIRECT (always runs). The full controller-driven handoff needs a
//      connected native host (the shield only RAISEs then), which is unavailable
//      in headless CI sandboxes. So we drive the *view* directly: send RAISE then
//      ENTER_HANDOFF straight to the relay's shield view via
//      chrome.tabs.sendMessage to frameId 0 — exactly the channel the
//      controller's `commandView` uses — at a HIGH generation so we out-generation
//      any LOWER a host-down reconcile may have emitted (the view drops commands
//      whose generation is older than the last it applied). This exercises the
//      real cross-realm machinery — the closed-shadow card, the page-field
//      unlock, the trusted-input gate, and the `shield.resume` round-trip back to
//      the SW — without a host. Asserted:
//        (a) selector-less ENTER_HANDOFF renders the card
//            (`[data-peek-shield-phase="handoff"]` on the host), a real keystroke
//            into a NON-allowed page field is still blocked, and clicking Done
//            posts `shield.resume` to the SW.
//        (b) the selector case unlocks the named field — a real (trusted) edit
//            into it is allowed through the shield.
//        (c) EXIT_HANDOFF re-locks (phase back to `up`).
//
//   2. FULL CONTROLLER PATH (test.skip(!host.connected)). With a real connected
//      host the controller itself RAISEs from the durable Level-4 state; we then
//      drive ENTER_HANDOFF/EXIT_HANDOFF over the same SW->view channel and observe
//      the host reach (and leave) the `handoff` phase end-to-end WITH a host
//      present — proving the relay/view wiring isn't host-dependent. Skips cleanly
//      when native messaging is unavailable here. (The controller's own
//      enterHandoff/onUserResume state machine — invoked in production by the MCP
//      `request_user_input` action over the native port — is covered exhaustively
//      by the unit suite; this E2E adds the real-browser cross-realm round-trip.)
//
// The closed-shadow Done button can't be reached by a Playwright `.click()`
// (Playwright can't pierce a closed shadow root) nor by `page.evaluate`
// (querySelector won't cross a closed root). We click it with a CDP
// `Input.dispatchMouseEvent` at the button's deterministic viewport coordinates
// (the card is centered fixed; Done sits at its bottom-right) — a real trusted
// activation that lands on whatever is painted there, closed shadow included.
// This is the same CDP technique shield.spec.ts defers for the Stop button.
//
// Run with `pnpm --filter @peekdev/extension build && pnpm --filter @peekdev/extension test:e2e`.

import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { getServiceWorker, launchExtension, spawnNativeHost } from './_harness';

const ORIGIN = 'https://handoff.test';

// A page with two text inputs: #locked (never unlocked) and #target (the
// selector-case unlock). Both have a capture-phase key counter so the spec can
// prove a trusted keystroke is blocked on #locked but allowed on #target.
const PAGE_HTML = `<!doctype html><meta charset="utf-8">
<input id="locked" type="text" />
<input id="target" type="text" />
<script>
  window.__keys = { locked: 0, target: 0 };
  for (const id of ['locked', 'target']) {
    document.getElementById(id).addEventListener('keydown', () => { window.__keys[id]++; }, true);
  }
</script>`;

// Generation high enough to out-generation any RAISE/LOWER the controller may
// have emitted while reconciling against a down host.
const GEN = 1_000_000;

/** Read the closed-shadow host's phase attribute from the page DOM (the host
 * element's own attribute is visible; only its shadow children are hidden). */
function hostPhase(page: Page): Promise<string | null> {
  return page
    .locator('[data-peek-shield-host]')
    .first()
    .getAttribute('data-peek-shield-phase')
    .catch(() => null);
}

/** Resolve the handoff.test tab's id from the SW (the page index is NOT a tab id). */
async function resolveTabId(sw: Worker): Promise<number> {
  return sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://handoff.test/*' });
    return tabs[0]?.id ?? -1;
  });
}

/** Send a ViewCommand to the relay's shield view (frameId 0) via the SW — the
 * same path the controller's `commandView` uses. */
function command(sw: Worker, tabId: number, cmd: Record<string, unknown>): Promise<void> {
  return sw.evaluate(
    async ({ id, c }) => {
      await chrome.tabs.sendMessage(id, c, { frameId: 0 });
    },
    { id: tabId, c: cmd },
  );
}

/** A CDP DOM.Node (only the fields this walker reads). */
interface CdpNode {
  nodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
}

/** Depth-first search of a pierced CDP DOM tree for the first node carrying
 * `class` containing `className`. CDP querySelector does NOT cross shadow
 * boundaries even with a pierced getDocument, so we walk shadowRoots ourselves. */
function findByClass(node: CdpNode, className: string): number | null {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length - 1; i += 2) {
    if (attrs[i] === 'class' && (attrs[i + 1] ?? '').split(/\s+/).includes(className)) {
      return node.nodeId;
    }
  }
  for (const child of [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
    ...(node.contentDocument ? [node.contentDocument] : []),
  ]) {
    const hit = findByClass(child, className);
    if (hit !== null) return hit;
  }
  return null;
}

/** CDP-click the handoff card's Done button — a real trusted activation. The
 * button is `.peek-card-done` inside a CLOSED shadow root, unreachable by
 * Playwright `.click()` or `page.evaluate`. CDP's DOM domain pierces closed
 * roots: walk the pierced tree to the button node, read its box model, then
 * dispatch a trusted mouse press/release at its center. */
async function clickDone(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const nodeId = findByClass(root as unknown as CdpNode, 'peek-card-done');
    if (nodeId === null)
      throw new Error('handoff e2e: Done button not found in the pierced DOM tree');
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
    // content quad: [x1,y1, x2,y2, x3,y3, x4,y4] — center is the mean of opposite corners.
    const q = model.content;
    const at = {
      x: ((q[0] ?? 0) + (q[4] ?? 0)) / 2,
      y: ((q[1] ?? 0) + (q[5] ?? 0)) / 2,
      button: 'left' as const,
      clickCount: 1,
    };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
  } finally {
    await cdp.detach();
  }
}

async function openHandoffPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, (r) => r.fulfill({ contentType: 'text/html', body: PAGE_HTML }));
  await page.goto(`${ORIGIN}/`);
  return page;
}

test.describe('input handoff (Plan B)', () => {
  test('view-direct: card renders, locked field blocked, target unlocks, Done resumes, EXIT re-locks', async () => {
    const launched = await launchExtension();
    const context = launched.context;
    try {
      const page = await openHandoffPage(context);
      const sw = await getServiceWorker(context);
      const tabId = await resolveTabId(sw);
      expect(tabId, 'tab id resolved from SW').toBeGreaterThanOrEqual(0);

      // Drive the view up, then into the (selector-less) handoff card.
      await command(sw, tabId, { kind: 'RAISE', generation: GEN, label: 'Working' });
      await expect.poll(() => hostPhase(page), { timeout: 10_000 }).toBe('up');

      // (a) Selector-less ENTER_HANDOFF renders the card (host phase -> handoff).
      await command(sw, tabId, {
        kind: 'ENTER_HANDOFF',
        generation: GEN + 1,
        prompt: 'Enter a value',
        framing: 'peek paused — your turn',
      });
      await expect.poll(() => hostPhase(page), { timeout: 10_000 }).toBe('handoff');

      // A real (trusted) keystroke into a NON-allowed page field is blocked: the
      // capture shield swallows it, so the counter stays 0.
      await page.locator('#locked').focus();
      await page.keyboard.type('xyz');
      expect(
        await page.evaluate(
          () => (window as unknown as { __keys: Record<string, number> }).__keys.locked,
        ),
        'keystroke into the locked field is blocked by the shield',
      ).toBe(0);

      // (a) Done posts shield.resume back to the SW. Observe its arrival via a
      // one-shot runtime.onMessage listener registered in the SW realm.
      await sw.evaluate(() => {
        (globalThis as { __resume?: unknown }).__resume = undefined;
        chrome.runtime.onMessage.addListener((msg: unknown): undefined => {
          if ((msg as { type?: string })?.type === 'shield.resume') {
            (globalThis as { __resume?: unknown }).__resume = msg;
          }
          return undefined;
        });
      });
      await clickDone(page);
      await expect
        .poll(() => sw.evaluate(() => (globalThis as { __resume?: unknown }).__resume ?? null), {
          timeout: 10_000,
        })
        .not.toBeNull();

      // (c) EXIT_HANDOFF re-locks: phase back to `up`.
      await command(sw, tabId, { kind: 'EXIT_HANDOFF', generation: GEN + 2 });
      await expect.poll(() => hostPhase(page), { timeout: 10_000 }).toBe('up');

      // (b) Selector case: ENTER_HANDOFF naming #target unlocks it; a real edit is
      // allowed through the shield (counter increments, value lands).
      await command(sw, tabId, {
        kind: 'ENTER_HANDOFF',
        generation: GEN + 3,
        prompt: 'Edit this field',
        framing: 'peek paused — your turn',
        selector: '#target',
      });
      await expect.poll(() => hostPhase(page), { timeout: 10_000 }).toBe('handoff');
      // The view focuses the unlocked field; type a real keystroke into it.
      await page.locator('#target').focus();
      await page.keyboard.type('hello');
      expect(
        await page.evaluate(
          () => (window as unknown as { __keys: Record<string, number> }).__keys.target,
        ),
        'keystroke into the unlocked target field is allowed through the shield',
      ).toBeGreaterThan(0);
      expect(
        await page.evaluate(() => (document.getElementById('target') as HTMLInputElement).value),
        'the real edit landed in the unlocked field',
      ).toBe('hello');
    } finally {
      await context.close();
    }
  });

  test('full controller path: connected host RAISEs, then handoff round-trips with a host present', async () => {
    const launched = await launchExtension();
    const host = await spawnNativeHost(launched);
    const context = host.context;
    try {
      // The shield only RAISEs with a connected host. Skip — not fail — when
      // native messaging is unavailable here (matches shield.spec.ts and the
      // plan's option-(b) fallback).
      test.skip(
        !host.connected,
        'native messaging unavailable in this environment — host never reached a stable connection',
      );

      const page = await openHandoffPage(context);

      // Arm Level 4 + reload so the controller reconciles from the durable level +
      // connected host and RAISEs (same handshake as shield.spec.ts).
      const swForArm = await getServiceWorker(context);
      await swForArm.evaluate(async (o) => {
        await chrome.storage.sync.set({ 'peek:enabledOrigins': [o] });
        await chrome.storage.sync.set({ 'peek:permissionLevels': { [o]: 4 } });
      }, ORIGIN);
      await page.reload();
      await expect.poll(() => hostPhase(page), { timeout: 15_000 }).toBe('up');

      // With the host connected, the handoff card + EXIT round-trip works
      // identically over the SW->view channel — the relay/view wiring is not
      // host-dependent. (The controller's enterHandoff/onUserResume settlement is
      // unit-covered; here we prove the cross-realm card render survives a real
      // connected-host session.) Out-generation the controller's live traffic.
      const sw = await getServiceWorker(context);
      const tabId = await resolveTabId(sw);
      expect(tabId).toBeGreaterThanOrEqual(0);

      await command(sw, tabId, {
        kind: 'ENTER_HANDOFF',
        generation: GEN,
        prompt: 'Your turn',
        framing: 'peek paused',
      });
      await expect.poll(() => hostPhase(page), { timeout: 10_000 }).toBe('handoff');

      await command(sw, tabId, { kind: 'EXIT_HANDOFF', generation: GEN + 1 });
      await expect.poll(() => hostPhase(page), { timeout: 10_000 }).toBe('up');
    } finally {
      await host.stop();
      await context.close();
    }
  });
});
