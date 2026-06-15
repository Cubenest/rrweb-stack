---
"@tracelane/playwright": minor
---

Capture network on every browser, not just Chromium.

The Playwright adapter previously captured network only via CDP, so on
Firefox/WebKit the network panel was always empty — even though the shared
`@tracelane/core` recorder already supports the framework-agnostic in-page
`rrweb/network@1` plugin (which `@tracelane/wdio` uses as its primary channel).

`runStart` now wires that in-page plugin (privacy-first defaults: URL/method/
status/timing, headers + bodies off) whenever `captureNetwork` is enabled, so
network capture works on Chromium, Firefox, and WebKit alike. On Chromium the
existing CDP path still runs and enriches the in-page rows with authoritative
status + true no-response failures (the report merges them, real status wins).
`captureNetwork: false` now disables both channels.
