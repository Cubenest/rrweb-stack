// passing.spec.ts — green test, asserts on real DOM, expects NO report
// written (ADR-0005 failed-only quota gate). This is the verification that
// recording overhead is paid only on failure.

import { $, browser, expect } from '@wdio/globals';

describe('tracelane-demo — passing', () => {
  it('navigates to the fixture and asserts the title', async () => {
    await browser.url(process.env.TRACELANE_DEMO_URL as string);
    const title = await $('#title');
    await expect(title).toHaveText('tracelane demo fixture');
  });
});
