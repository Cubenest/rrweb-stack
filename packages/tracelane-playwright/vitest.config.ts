import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // The browser E2E (e2e/) runs under Playwright via `pnpm test:e2e`, never vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
});
