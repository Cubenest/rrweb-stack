---
"@cubenest/rrweb-core": minor
---

feat(rrweb-core): framework-agnostic network capture plugin.

Adds `getRecordNetworkPlugin(options?)` adapted from PostHog's
Apache-2.0 network-plugin.ts (NOTICE attribution added). Emits
EventType.Plugin events with name 'rrweb/network@1' from a
recorder running anywhere — in-browser extension, WDIO Service,
future Playwright/Cypress reporters. Wraps fetch + XHR +
PerformanceObserver. Bodies + headers default OFF; opt-in via
options. Masking pipes through the existing redactBody +
redactNetworkHeaders helpers.

Consumer integration ships separately in subsequent commits
(tracelane-wdio recorder bundle, peek-extension recorder, and
tracelane-report panel extraction).
