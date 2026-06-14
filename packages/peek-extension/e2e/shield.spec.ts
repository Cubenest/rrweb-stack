// peek control-shield E2E (Plan A, Task 9).
//
// Exercises the Level-4 control shield end-to-end in a real Chromium with the
// unpacked extension loaded and a real native-messaging host connected (so the
// SW's `hostState` flips to 'connected' and the shield is allowed to RAISE).
//
// The two load-bearing behaviors asserted here cannot be observed by the unit
// suite (they live across the page realm + the closed shadow root + the SW
// state machine):
//
//   1. RAISE: arming Level 4 for the origin (while the host is connected) makes
//      the closed-shadow overlay host appear in the top frame.
//   2. INPUT GATING: a real (isTrusted) user click is swallowed by the capture
//      shield, while a synthetic `el.click()` (isTrusted:false — peek's own
//      dispatch path) still reaches the page handler.
//   3. TEARDOWN: dropping the origin to Level 1 (the same write the Stop button
//      ultimately triggers via `shield.stop` -> `dropToSafeLevel`) tears the
//      overlay down.
//
// The "click the Stop button" leg is split out as a `test.fixme` below: the
// button lives in a *closed* shadow root, so Playwright can't dispatch a
// trusted activation into it. Driving it needs CDP `Input.dispatchMouseEvent`
// at the banner's screen coordinates — deferred until the harness grows a CDP
// helper. The teardown assertion above covers the same end-state (Level 1, no
// overlay) via the storage write that Stop performs.
//
// Run with `pnpm --filter @peekdev/extension build && pnpm --filter @peekdev/extension test:e2e`.
//
// ENVIRONMENT REQUIREMENT: this spec needs the launched browser to successfully
// `chrome.runtime.connectNative('com.cubenest.peek')` (the shield only RAISEs
// when a host is connected). That requires native-messaging to be functional in
// the test browser. In some headless CI sandboxes the bundled "Chrome for
// Testing" reports "Specified native messaging host not found" for any manifest
// — native messaging is effectively unavailable there — and this spec cannot
// run. The relay/shadow overlay mechanics themselves are exercised by the unit
// suite (shield-recorder-invisibility, shield-controller); this E2E adds the
// real-browser raise/gate/teardown round-trip on top.

import { expect, test } from '@playwright/test';
import { getServiceWorker, launchExtension, spawnNativeHost } from './_harness';

test.describe('control shield (Level 4)', () => {
  test('raises overlay, blocks real input, level-drop tears it down', async () => {
    const launched = await launchExtension();

    // Wire a REAL native host so the SW's `hostState` becomes 'connected' (the
    // controller refuses to RAISE otherwise — see ShieldController#onLevelChanged).
    // This relaunches the profile so the host is present at startup; use the
    // FRESH context it returns from here on.
    const host = await spawnNativeHost(launched);
    const context = host.context;

    const origin = 'https://example.test';
    const page = await context.newPage();
    await page.route(`${origin}/**`, (r) =>
      r.fulfill({ contentType: 'text/html', body: '<button id="b">go</button>' }),
    );
    await page.goto(`${origin}/`);

    // Arm Level 4 by writing the permission-levels key directly. `enabledOrigins`
    // is a *different* key (activation); the shield keys off `permissionLevels`.
    const swForArm = await getServiceWorker(context);
    await swForArm.evaluate(async (o) => {
      await chrome.storage.sync.set({ 'peek:enabledOrigins': [o] });
      await chrome.storage.sync.set({ 'peek:permissionLevels': { [o]: 4 } });
    }, origin);

    // Reload so the relay re-injects and re-announces `shield.ready`; the SW
    // reconciles from the now-Level-4 durable state + connected host and RAISEs.
    // (The storage-change fan-out also RAISEs, but a reload makes the handshake
    // path deterministic regardless of SW-instance timing.)
    await page.reload();

    // Overlay host appears (top-frame, marker attribute on the closed-shadow host).
    await expect
      .poll(() => page.locator('[data-peek-shield-host]').count(), { timeout: 15_000 })
      .toBe(1);

    // A real user click on the page button is swallowed by the capture shield.
    await page.evaluate(() => {
      (window as unknown as { __clicked: number }).__clicked = 0;
      document.getElementById('b')?.addEventListener('click', () => {
        (window as unknown as { __clicked: number }).__clicked++;
      });
    });
    await page.locator('#b').click(); // a trusted click (Playwright synthesizes a real input event)
    expect(
      await page.evaluate(() => (window as unknown as { __clicked: number }).__clicked),
      'trusted click is blocked by the shield',
    ).toBe(0);

    // A synthetic el.click() (isTrusted:false) still reaches the handler — this
    // is the path peek's own action dispatch uses, so it must pass the shield.
    await page.evaluate(() => document.getElementById('b')?.click());
    expect(
      await page.evaluate(() => (window as unknown as { __clicked: number }).__clicked),
      'synthetic click passes the shield',
    ).toBe(1);

    // Drop to Level 1 (the end-state Stop reaches via dropToSafeLevel) -> teardown.
    const swForDrop = await getServiceWorker(context);
    await swForDrop.evaluate(async (o) => {
      await chrome.storage.sync.set({ 'peek:permissionLevels': { [o]: 1 } });
    }, origin);
    await expect
      .poll(() => page.locator('[data-peek-shield-host]').count(), { timeout: 10_000 })
      .toBe(0);

    await host.stop();
    await context.close();
  });

  // The Stop button lives in a CLOSED shadow root; Playwright can't dispatch a
  // trusted click into it. Drive it via CDP `Input.dispatchMouseEvent` at the
  // banner's screen coords once the harness grows a CDP helper. The teardown
  // leg above already asserts the same end-state (Level 1 + no overlay) through
  // the storage write Stop performs.
  test.fixme('Stop button -> shield.stop -> Level 1 (needs CDP trusted-click)', async () => {});
});
