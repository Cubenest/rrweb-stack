// Public API surface for @tracelane/wdio.

// The WebdriverIO Service — the default, recommended surface (ADR-0004, P1 PRD §M.1).
export { default, default as TraceLaneService } from './service';

// Hook-factory alternative (also published at `@tracelane/wdio/hooks`).
export { traceLaneHooks } from './hooks';
export type { TraceLaneHookOptions, TraceLaneHooks } from './hooks';

// User-facing options.
export type { CaptureOptions, TraceLaneOptions } from './options';
export { DEFAULT_OUT_DIR } from './options';

// The BrowserExecutor adapter (advanced use / custom integrations).
export { createWdioExecutor } from './wdio-executor';
export type { WdioBrowser } from './wdio-executor';

// Re-export the framework result-shape switch + the recognized framework union.
export { normalizeResult } from './framework-result';
export type { Framework, NormalizedResult } from './framework-result';
