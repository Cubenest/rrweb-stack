// Playwright config for the live demo report generator (scripts/gen-demo-report.mjs).
//
// Mirrors e2e/playwright.config.ts but writes to ./demo-out and is driven by the
// generator. One worker, no retries → the single deliberate failure is
// deterministic. Registers the BUILT reporter (../dist/reporter.js) in 'failed'
// mode so only the failing test writes a report. The fixture (imported by the
// spec from ../../dist/fixture.js) resolves its outDir from TRACELANE_OUT_DIR,
// which the generator sets to an absolute ./demo-out before spawning Playwright.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './demo-results',
  workers: 1,
  retries: 0,
  reporter: [['line'], ['../dist/reporter.js', { mode: 'failed', outDir: './demo-out' }]],
  use: {
    // Coexists with Playwright's own trace machinery.
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],
});
