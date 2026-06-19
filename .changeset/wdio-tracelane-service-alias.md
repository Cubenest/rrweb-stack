---
"wdio-tracelane-service": minor
---

Add `wdio-tracelane-service`, a thin alias of `@tracelane/wdio` published under the
WebdriverIO `wdio-*` convention name. It re-exports the canonical service verbatim
(default `TraceLaneService`, the `traceLaneHooks` factory at
`wdio-tracelane-service/hooks`, and the option/executor types), so a bare
`services: ['tracelane']` entry and the `wdio config` setup wizard resolve it.
`@tracelane/wdio` remains canonical; this is additive and non-breaking.
