// Public API surface for @tracelane/wdio.

// The WebdriverIO Service — the default, recommended surface (ADR-0004, P1 PRD §M.1).
export { default, default as TraceLaneService } from './service.js';

// Hook-factory alternative (also published at `@tracelane/wdio/hooks`).
export { traceLaneHooks } from './hooks.js';
export type { TraceLaneHookOptions, TraceLaneHooks } from './hooks.js';

// User-facing options.
export type { CaptureOptions, TraceLaneOptions } from './options.js';
export { DEFAULT_OUT_DIR } from './options.js';

// The BrowserExecutor adapter (advanced use / custom integrations).
export { createWdioExecutor } from './wdio-executor.js';
export type { WdioBrowser } from './wdio-executor.js';

// Re-export the framework result-shape switch + the recognized framework union.
export { normalizeResult } from './framework-result.js';
export type { Framework, NormalizedResult } from './framework-result.js';
