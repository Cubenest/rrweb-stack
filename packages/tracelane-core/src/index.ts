// Public API surface for @tracelane/core.

// BrowserExecutor — the framework-agnostic driver surface adapters implement.
export type { BrowserExecutor } from './browser-executor.js';

// CDP network capture (Task 2.16 / P1 PRD §E.2) — framework-agnostic, shared by
// the WDIO and Playwright adapters via the BrowserExecutor surface. `__internal`
// exposes the pure page-side logger + method resolver so @tracelane/report's
// cross-package contract test can exercise core's real output (the test must
// live in report — which depends on core — to keep the dep edge one-directional).
export { __internal, attachNetworkCapture } from './network-capture.js';

// In-page rrweb bundle loader — reads the adapter's built dist/rrweb-bundle.js
// off disk (pass the adapter's import.meta.url). Shared across adapters.
export { loadRrwebBundle } from './load-rrweb-bundle.js';

// Recorder controller — in-page buffer install + Node-polled drain (ADR-0006).
export { createRecorder, DEFAULT_COOLDOWN_MS, DEFAULT_DRAIN_INTERVAL_MS } from './recorder.js';
export type { FinalizeResult, Recorder, RecorderOptions, TestOutcome } from './recorder.js';
export type { ConsolePluginOptions, NetworkPluginOptions } from './page-script.js';

// Capture mode switch (ADR-0005).
export { DEFAULT_MODE, resolveMode } from './mode.js';
export type { Mode } from './mode.js';

// 25 MB report-size guard with FullSnapshot-preserving prune (ADR-0005).
export {
  MAX_REPORT_BYTES,
  PRUNE_EVENT_TAG,
  pruneToSizeBudget,
  serializedSize,
} from './size-guard.js';
export type { PruneEventPayload, PruneResult } from './size-guard.js';
