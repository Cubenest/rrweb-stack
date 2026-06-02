// Public API surface for @tracelane/playwright.
//
// Two entry points cover the common usage:
//   - the Reporter (default export here + the ./reporter subpath) goes in
//     playwright.config.ts: `reporter: [['@tracelane/playwright', { mode }]]`;
//   - the fixture (./fixture subpath, re-exported here) replaces
//     `@playwright/test`'s test: `import { test, expect } from '@tracelane/playwright'`.

// The Reporter (config + summary). Default export so the string form
// `['@tracelane/playwright', opts]` resolves it.
export { TraceLaneReporter, default } from './reporter.js';

// The auto-fixture (records every test, writes a report on failure).
export { test, expect, tracelaneFixture } from './fixture.js';
export type { BundleLoader } from './fixture.js';

// Building blocks (useful for custom adapters / advanced wiring).
export { createPlaywrightExecutor } from './playwright-executor.js';
export { DEFAULT_OUT_DIR, resolveOptions } from './options.js';
export type { ResolvedOptions, TraceLaneOptions } from './options.js';
export { isPassed, mapStatus } from './result-status.js';
export { runFinalize, runStart, runTracelaneSession } from './playwright-session.js';
export type { FinalizeInput, StartInput, StartedSession } from './playwright-session.js';
