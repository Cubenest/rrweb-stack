// Playwright config for the peek extension smoke (Task 3.29).
//
// Persistent-context loading of the unpacked extension lives in smoke.spec.ts;
// this config tells Playwright where to find that spec and not to try to
// configure a Chromium project upfront (the spec launches Chromium itself via
// chromium.launchPersistentContext, which is the only path that loads
// unpacked extensions).

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // The smoke spawns a real Chromium + a peek-mcp child process and exercises
  // SQLite — give it more headroom than the Playwright default 30 s.
  timeout: 60_000,
  reporter: [['list']],
  // No `use` / projects: smoke.spec.ts owns the launch via
  // chromium.launchPersistentContext (the only API that supports MV3
  // extensions). Playwright's `use.headless` etc. apply only to the
  // declarative `browser` fixture, which we don't use.
});
