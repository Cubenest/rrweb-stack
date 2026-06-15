---
"@tracelane/core": patch
"@tracelane/report": patch
"@tracelane/wdio": patch
---

docs: correct the package taglines now that Playwright has shipped.

The shared tagline still read "the reporter for your WebdriverIO tests —
Playwright and Cypress on the roadmap." Playwright is now a published, supported
adapter (reporter + fixture), so the npm-page taglines now read "the recorder
for your WebdriverIO and Playwright tests — Cypress on the roadmap." Docs-only;
no code change.
