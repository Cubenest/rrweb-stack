// Demo spec — FAILS ON PURPOSE so the auto-fixture (mode: 'failed') writes a
// report. The redacted artifact is published at /demo/playwright-checkout-failure.html.
//
// One run exercises the full alpha.2 story:
//   - page A (products): add three items, each firing a real HTTP 404 on
//     /api/recommendations/<sku> (a genuine failed response in the Network
//     panel — status populated, not a connection error);
//   - a NAVIGATION products → checkout, via a real link click, so rrweb keeps
//     recording across it (the alpha.2 nav fix: page.on('framenavigated') →
//     recorder.reinject, which emits a `tracelane.nav` boundary);
//   - page B (checkout): a console line + a POST /api/checkout → 500 (the
//     headline failure);
//   - a final assertion that never holds, so the test fails and the report is
//     written.
//
// Imported from the BUILT dist fixture so the demo exercises the published surface.
import { expect, test } from '../../dist/fixture.js';

const PORT = process.env.TRACELANE_DEMO_PORT;
if (!PORT) {
  throw new Error(
    'TRACELANE_DEMO_PORT is not set — run this spec via `pnpm --filter @tracelane/playwright demo:gen`, not Playwright directly.',
  );
}
const base = `http://127.0.0.1:${PORT}`;

test('Checkout › placing an order surfaces a 500 from the payment gateway', async ({ page }) => {
  // Page A: browse + add three items (each fires a 404 recommendations call).
  await page.goto(`${base}/products.html`);
  await page.click('#add-CLAW-22');
  await page.click('#add-TAPE-5M');
  await page.click('#add-BIT-SET');
  await expect(page.locator('#cart')).toHaveText('Cart: 3 items');
  // Let the async 404s land in the recorder buffer before the navigation flush
  // (the CDP → console → buffer chain is async; 500ms is the value the e2e
  // suite proved reliable before a navigation).
  await page.waitForTimeout(500);

  // Navigation A → B via a real link click. rrweb must reinject and keep
  // recording (alpha.2 nav fix).
  await page.click('#to-checkout');
  await expect(page.locator('h2')).toHaveText('Checkout');

  // Page B: place the order → 500. Console gets the error body.
  await page.click('#place-order');
  await expect(page.locator('#status')).toHaveText(/Order failed \(HTTP 500\)/);
  await page.waitForTimeout(500);

  // Deliberate failure: the order never succeeds, so this never holds. This is
  // the assertion miss that makes tracelane write the report.
  await expect(page.locator('#status')).toHaveText('Order placed');
});
