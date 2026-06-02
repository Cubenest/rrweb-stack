// E2E smoke Playwright config (Task 12).
//
// Registers tracelane's BUILT reporter (../dist/reporter.js) alongside the
// 'line' reporter, with the tracelane trace on-first-retry to prove the
// reporter coexists with Playwright's own tracing. One worker, no retries, so
// the single deliberate failure is deterministic. The fixture (imported by the
// spec from ../dist/fixture.js) is what actually records + writes the report.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  workers: 1,
  retries: 0,
  reporter: [['line'], ['../dist/reporter.js', { mode: 'failed', outDir: './e2e-out' }]],
  use: {
    // Prove coexistence with Playwright's own trace machinery.
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
});
