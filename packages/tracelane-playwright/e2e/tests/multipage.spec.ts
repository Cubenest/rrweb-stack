import { expect, test } from '../../dist/fixture.js';

const pageA = new URL('../fixture.html', import.meta.url).href;
const pageB = new URL('../fixture-b.html', import.meta.url).href;

test('captures events across a navigation then fails', async ({ page }) => {
  await page.goto(pageA);
  await page.click('#go');
  await page.waitForTimeout(50);
  await page.goto(pageB); // navigation: reinject must fire
  await page.click('#go-b');
  await page.waitForTimeout(50);
  await expect(page.locator('#title-b')).toHaveText('nope'); // deliberate fail
});
