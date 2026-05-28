// failing.spec.ts — deliberate failure that exercises all three signal types:
//   1. rrweb DOM mutations (typing into inputs, clicking the button)
//   2. console.log (the fixture's click handler emits one)
//   3. failed network request (the click handler fetches /api/will-fail, 404)
//
// Expected outcome: tracelane-reports/<spec>--<title>--<cid>-<ts>.html written.

import { $, browser, expect } from '@wdio/globals';

describe('tracelane-demo — failing', () => {
  it('records DOM + console + network then fails on purpose', async () => {
    await browser.url(process.env.TRACELANE_DEMO_URL as string);

    // DOM interaction — recorder captures the value changes.
    const user = await $('#user');
    await user.setValue('jane@example.com');

    // Password masking proof (QA item C.5). Type a value that should be masked
    // in the replay; the rrweb recorder's input-masking primitive replaces the
    // observed `value` with masked chars before the event reaches the report.
    const pw = await $('#pw');
    await pw.setValue('hunter2');

    // Click → console.log + fetch('/api/will-fail') → 404.
    const go = await $('#go');
    await go.click();

    // Give the click handler's async fetch + recorder poll a moment.
    await browser.pause(500);

    // Intentional failure: the report file IS this test's deliverable. The
    // assertion message becomes the report's failure context.
    await expect($('#title')).toHaveText('this text never matches — intentional QA failure');
  });
});
