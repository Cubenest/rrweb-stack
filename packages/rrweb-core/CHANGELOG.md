# @cubenest/rrweb-core

## 0.1.0-alpha.2

### Minor Changes

- 7100b3f: feat(rrweb-core): framework-agnostic network capture plugin.

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

## 0.1.0-alpha.1

### Patch Changes

- Fix: relative imports now carry `.js` extensions so the package resolves cleanly under bare Node / NodeNext ESM. The previous `0.1.0-alpha.0` shipped with extensionless imports and would fail at runtime when consumed by NodeNext downstream packages.
