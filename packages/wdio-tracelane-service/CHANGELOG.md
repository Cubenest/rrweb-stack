# wdio-tracelane-service

## 0.1.0-alpha.1

### Minor Changes

- 6864b5c: Add `wdio-tracelane-service`, a thin alias of `@tracelane/wdio` published under the
  WebdriverIO `wdio-*` convention name. It re-exports the canonical service verbatim
  (default `TraceLaneService`, the `traceLaneHooks` factory at
  `wdio-tracelane-service/hooks`, and the option/executor types), so a bare
  `services: ['tracelane']` entry and the `wdio config` setup wizard resolve it.
  `@tracelane/wdio` remains canonical; this is additive and non-breaking.

### Patch Changes

- Updated dependencies [69cd9c1]
- Updated dependencies [db8d39b]
  - @tracelane/wdio@0.1.0-alpha.23
