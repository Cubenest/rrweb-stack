// The Playwright Reporter (P1 PRD §B). Registered in playwright.config.ts as
// `reporter: [['@tracelane/playwright', { mode, outDir }]]`.
//
// IMPORTANT: the Reporter does NOT build reports — the per-test HTML build lives
// in the auto-fixture, which is the only place with a live `page` + `testInfo`.
// By design the Reporter never touches `page`. Its job is config validation
// (resolveOptions in the constructor so invalid config surfaces early) and
// tallying pass/fail for future use.
//
// NOTE on captureNetwork: reporter constructor options do NOT propagate to the
// fixture — they run in separate Playwright worker processes. Setting
// `captureNetwork: false` here is silently ignored by the fixture's CDP attach.
// Control the fixture via TRACELANE_CAPTURE_NETWORK=false env var instead (see
// options.ts resolveOptions for the env contract).

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { type TraceLaneOptions, resolveOptions } from './options.js';

/**
 * tracelane's Playwright reporter. Pair it with the fixture
 * (`import { test } from '@tracelane/playwright/fixture'`) — the fixture records
 * + writes reports; this reporter validates config at startup.
 */
export class TraceLaneReporter implements Reporter {
  private failed = 0;

  constructor(opts: TraceLaneOptions = {}) {
    // Resolve up front so an invalid config surfaces early (throws on bad input).
    resolveOptions(opts);
  }

  /** The fixture + Playwright own the run output; this reporter is silent. */
  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.failed = 0;
  }

  onTestBegin(_test: TestCase, _result: TestResult): void {
    // No-op: the fixture starts the recorder per test.
  }

  onTestEnd(test: TestCase, _result: TestResult): void {
    // TestCase.ok() is Playwright's "ended as expected" check (so test.fail()
    // expected-failures count as ok). A not-ok test is what the fixture builds a
    // report for in 'failed' mode.
    if (!test.ok()) this.failed++;
  }

  onEnd(_result: FullResult): void {
    // No-op: output removed (printsToStdio() is false; console.log here would
    // confuse Playwright which may add its own terminal reporter). The fixture
    // already wrote report files.
  }
}

export default TraceLaneReporter;
