/**
 * Vitest global setup for the peek extension unit tests.
 *
 * Installs `@webext-core/fake-browser` (a faithful in-memory implementation of
 * the WebExtension APIs — the same fake WXT bundles) as the global `chrome`
 * and `browser`. The storage helpers and any other `chrome.*` callers resolve
 * against it without a real browser.
 *
 * We use `@webext-core/fake-browser` directly rather than WXT's `WxtVitest`
 * plugin to stay compatible with the repo's Vite 5 / vitest 2 toolchain (see
 * vitest.config.ts for the rationale).
 */
import { fakeBrowser } from '@webext-core/fake-browser';

// fakeBrowser implements the Promise-based WebExtension API surface. Chrome's
// MV3 `chrome.*` namespace is Promise-based too, so the same object backs both
// globals for our tests.
const g = globalThis as unknown as { chrome: unknown; browser: unknown };
g.chrome = fakeBrowser;
g.browser = fakeBrowser;
