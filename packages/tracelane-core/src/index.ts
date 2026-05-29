// Public API surface for @tracelane/core.

// BrowserExecutor — the framework-agnostic driver surface adapters implement.
export type { BrowserExecutor } from './browser-executor.js';

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
