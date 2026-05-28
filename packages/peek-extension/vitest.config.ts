import { defineConfig } from 'vitest/config';

// The unit tests here cover the *pure* extension logic (reconnect backoff,
// origin/match-pattern derivation, per-site consent storage). They never
// launch a browser — full browser E2E is Phase 3e (Playwright).
//
// NOTE: we deliberately do NOT use WXT's `WxtVitest` plugin. That plugin pulls
// in WXT's `wxt:download` Vite plugin, which uses the Vite 6+ plugin `filter`
// API. The repo's vitest (2.1.x) runs on Vite 5, where `filter` is ignored and
// the plugin's `load` hook runs for every module — turning local file loads
// into `fetch()` calls that throw "Failed to parse URL". Instead, `setup.ts`
// installs `@webext-core/fake-browser` (the same fake WXT ships) as the global
// `chrome`, which is all these tests need.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    // Exclude the Playwright e2e tree (Task 3.29). Vitest's default glob would
    // otherwise pick up `e2e/smoke.spec.ts`, which uses Playwright's `test`
    // export (not vitest's) and spawns a real Chromium — never what `pnpm test`
    // wants. Playwright finds the spec via `e2e/playwright.config.ts` instead.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.output/**', 'e2e/**'],
  },
});
