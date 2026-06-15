// E2E for the Windows-audit fix: the "run `peek init`" setup hint must be
// REACHABLE when the native host was never registered (Phase B, change 3).
//
// The bug: when chrome.runtime.connectNative throws because no host manifest is
// installed, background.ts parks hostState in 'reconnecting' forever. The
// side-panel setup hint used to be gated on the 'disconnected' state only, so a
// user whose host was never registered saw a perpetual "Reconnecting…" pill
// with no guidance. The fix tracks consecutive failed reconnect attempts and
// surfaces the hint once isReconnectStalled() crosses its threshold.
//
// This spec deliberately does NOT wire a native host (unlike shield.spec.ts's
// spawnNativeHost) — a missing host is exactly the failure mode under test. We
// launch the extension, open the real side panel, and assert that:
//   1. the SW climbs reconnectAttempts past the stall threshold (it never
//      connects, so it retries with backoff), and
//   2. the rendered side panel shows the "run `peek init`" hint while the pill
//      still reads "Reconnecting…".
//
// Timing: reconnectAttempts increments on each scheduleReconnect with full
// jitter over a 1s→2s→4s… backoff, so reaching the 4-attempt threshold takes a
// few seconds of wall time. We poll generously (well under the 60s file
// timeout) rather than sleeping a fixed amount.

import { expect, test } from '@playwright/test';
import { RECONNECT_STALLED_AFTER_ATTEMPTS } from '../src/background/backoff';
import {
  type LaunchedExtension,
  extensionIdFromWorker,
  getServiceWorker,
  launchExtension,
} from './_harness';

let launched: LaunchedExtension | undefined;

test.beforeAll(async () => {
  // No spawnNativeHost(): a never-registered host is the scenario under test.
  launched = await launchExtension();
});

test.afterAll(async () => {
  await launched?.context.close();
});

test('setup hint is reachable from a stuck reconnect (native host never registered)', async () => {
  expect(launched, 'extension launched').toBeDefined();
  if (launched === undefined) throw new Error('launched not initialized'); // narrowing
  const ctx = launched.context;

  const sw = await getServiceWorker(ctx);
  const extId = extensionIdFromWorker(sw);

  // Open the real side panel page. StatusHeader mounts at the top of App and
  // polls getNativeHostState every 2s, so it reflects the SW's live state.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);

  // Probe the SW's host state + attempt count straight from the panel (a real
  // extension-page sender, which the SW router accepts). This both verifies the
  // precondition (climbing attempts while never connecting) and keeps the MV3
  // worker warm so its in-memory reconnectAttempts isn't reset by a wake.
  const probe = (): Promise<{ state: string; reconnectAttempts: number }> =>
    panel.evaluate(
      () =>
        new Promise<{ state: string; reconnectAttempts: number }>((res) => {
          chrome.runtime.sendMessage({ type: 'getNativeHostState' }, (r) => {
            void chrome.runtime.lastError; // swallow no-receiver during a wake
            const v = (r as { state?: string; reconnectAttempts?: number } | undefined) ?? {};
            res({ state: v.state ?? 'unknown', reconnectAttempts: v.reconnectAttempts ?? 0 });
          });
        }),
    );

  // Wait until the SW has failed to connect enough times to be "stalled".
  // (It never connects here — no host manifest — so attempts only climb.)
  await expect
    .poll(async () => (await probe()).reconnectAttempts, {
      message: 'SW reconnectAttempts climbs past the stall threshold',
      timeout: 40_000,
      intervals: [500],
    })
    .toBeGreaterThanOrEqual(RECONNECT_STALLED_AFTER_ATTEMPTS);

  // It must be the 'reconnecting' state (not 'disconnected') that exposes the
  // hint — that is precisely the previously-unreachable path.
  const observed = await probe();
  expect(observed.state, 'host is stuck reconnecting, not disconnected').toBe('reconnecting');

  // The rendered side panel now shows the setup hint. The header polls on a 2s
  // interval, so give it a beat past the threshold crossing to repaint.
  const hint = panel.locator('.peek-status-hint', { hasText: 'peek init' });
  await expect(hint, 'the "run `peek init`" setup hint is visible').toBeVisible({
    timeout: 10_000,
  });

  // And the pill is still the reconnecting label (we surface guidance WITHOUT
  // lying about the connection state).
  await expect(panel.locator('.peek-status-label')).toHaveText('Reconnecting…');

  await panel.close();
});
