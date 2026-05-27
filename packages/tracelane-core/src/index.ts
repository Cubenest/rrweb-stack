// Public API surface for @tracelane/core.

// BrowserExecutor — the framework-agnostic driver surface adapters implement.
export type { BrowserExecutor } from './browser-executor';

// Recorder controller — in-page buffer install + Node-polled drain (ADR-0006).
export { createRecorder, DEFAULT_COOLDOWN_MS, DEFAULT_DRAIN_INTERVAL_MS } from './recorder';
export type { Recorder, RecorderOptions } from './recorder';
export type { ConsolePluginOptions } from './page-script';
