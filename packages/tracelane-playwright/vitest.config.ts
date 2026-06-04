import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // The browser E2E (e2e/) and the live-demo spec (demo/) run under Playwright
    // — via `pnpm test:e2e` and `pnpm demo:gen` respectively — never vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', 'demo/**'],
  },
});
