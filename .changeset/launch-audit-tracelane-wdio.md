---
"@tracelane/wdio": minor
---

Launch-readiness fixes to the WebdriverIO reporter Service:

- **`report: { footer: false }` opt-out** is now real — the option is threaded
  through to the report template so the attribution footer can be suppressed
  (it was documented but previously had no effect).
- **Capture true network failures.** The CDP path now also subscribes to
  `Network.loadingFailed`, so genuine no-response errors (CORS failure, offline,
  abort → status 0) surface in the Network panel, correlated back to their HTTP
  method. Previously only `responseReceived` (status ≥ 400) was captured.
- **Docs corrected.** The network-capture section + browser matrix now lead with
  the default CDP-independent in-page `rrweb/network@1` plugin (works on
  Firefox/Safari/cloud-Selenium), with CDP as an enhancement; the options
  JSDoc accurately describes default (PerformanceObserver-only) behavior.
- **Fix hook-factory example.** The README wired a non-existent `beforeCommand`;
  it now correctly uses `afterCommand` for post-navigation re-injection.
