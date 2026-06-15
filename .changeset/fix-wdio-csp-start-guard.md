---
"@tracelane/wdio": patch
---

Never fail the user's test when rrweb capture can't start (e.g. a CSP that
blocks `'unsafe-eval'`).

`TraceLaneSession.onBeforeTest` called `recorder.start()` without a guard, so a
page whose Content-Security-Policy blocks in-page script evaluation would throw
the injection error straight out of the WDIO `beforeTest` hook — tracelane
breaking the very test it was meant to observe. (The Playwright adapter already
degrades to a disabled session on the same failure.)

The start is now best-effort: on failure the recorder is dropped (so
`afterTest`/`after` write nothing and never re-throw), a single warning is
logged, and capture is retried on later tests in case the CSP is page-specific.
