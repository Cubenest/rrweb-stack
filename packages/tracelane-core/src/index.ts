// Public API surface for @tracelane/core.

// BrowserExecutor — the framework-agnostic driver surface adapters implement.
export type { BrowserExecutor } from './browser-executor';

// Recorder controller — in-page buffer install + Node-polled drain (ADR-0006).
export { createRecorder, DEFAULT_COOLDOWN_MS, DEFAULT_DRAIN_INTERVAL_MS } from './recorder';
export type { FinalizeResult, Recorder, RecorderOptions, TestOutcome } from './recorder';
export type { ConsolePluginOptions } from './page-script';

// Capture mode switch (ADR-0005).
export { DEFAULT_MODE, resolveMode } from './mode';
export type { Mode } from './mode';

// 25 MB report-size guard with FullSnapshot-preserving prune (ADR-0005).
export { MAX_REPORT_BYTES, PRUNE_EVENT_TAG, pruneToSizeBudget, serializedSize } from './size-guard';
export type { PruneEventPayload, PruneResult } from './size-guard';
