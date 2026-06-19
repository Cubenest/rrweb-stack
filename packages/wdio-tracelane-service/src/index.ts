// wdio-tracelane-service — a thin, wdio-convention-named alias of `@tracelane/wdio`.
//
// WebdriverIO resolves a bare service string like `services: ['tracelane']` to the
// package `wdio-tracelane-service`, and the `wdio config` setup wizard only lists
// plugins whose names follow the `wdio-*` convention. The canonical package is the
// scoped `@tracelane/wdio` (a WebdriverIO Service), whose name lacks that segment —
// so this package exists purely to provide the discoverable name. It adds no logic;
// it re-exports the entire public surface of `@tracelane/wdio` verbatim, including the
// default `TraceLaneService` that the bare-string / wizard wiring loads.
export * from '@tracelane/wdio';
export { default } from '@tracelane/wdio';
