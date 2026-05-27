// Smoke spec (Task 2.17): a WDIO + Mocha test that intentionally fails on Chrome.
//
// On failure, TraceLaneService (registered in wdio.conf.ts in `failed` mode)
// writes a self-contained HTML report to ./tracelane-reports. The post-run
// assertion (in wdio.conf's onComplete) verifies a single .html report exists
// and is < 25 MB.

import { $, browser, expect } from '@wdio/globals';

describe('tracelane wdio smoke', () => {
  it('records a session and fails on purpose so a report is written', async () => {
    // Navigate to the fixture (the FIXTURE_URL is injected by wdio.conf).
    await browser.url(process.env.TRACELANE_FIXTURE_URL as string);

    const title = await $('#title');
    await expect(title).toHaveText('tracelane smoke');

    // Interact so the recorder captures DOM mutations, a console line, and a
    // failed network request (404) routed through CDP.
    const go = await $('#go');
    await go.click();
    await go.click();

    // Give the click handler's async fetch + the recorder's poll a moment.
    await browser.pause(500);

    // Intentional failure: this is the smoke test's whole point — a failed test
    // must yield a report. The assertion message becomes the report's error.
    await expect($('#title')).toHaveText('this text never matches — intentional smoke failure');
  });
});
