// The Playwright Reporter (P1 PRD §B). Registered in playwright.config.ts as
// `reporter: [['@tracelane/playwright', { mode, outDir }]]`.
//
// IMPORTANT: the Reporter does NOT build reports — the per-test HTML build lives
// in the auto-fixture, which is the only place with a live `page` + `testInfo`.
// By design the Reporter never touches `page`. Its job is config + a one-line
// end-of-run summary so the user sees where reports landed and in which mode.
// onTestEnd tallies pass/fail for the summary.

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { type ResolvedOptions, type TraceLaneOptions, resolveOptions } from './options.js';

/**
 * tracelane's Playwright reporter. Pair it with the fixture
 * (`import { test } from '@tracelane/playwright/fixture'`) — the fixture records
 * + writes reports; this reporter validates config and prints the summary.
 */
export class TraceLaneReporter implements Reporter {
  private readonly opts: TraceLaneOptions;
  private resolved: ResolvedOptions;
  private total = 0;
  private failed = 0;

  constructor(opts: TraceLaneOptions = {}) {
    this.opts = opts;
    // Resolve once up front (constructor time) so an invalid config surfaces
    // early; re-resolved in onEnd to honor env set during the run.
    this.resolved = resolveOptions(opts);
  }

  /** The fixture + Playwright own the run output; we only print a final line. */
  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.total = suite.allTests().length;
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
    // Re-resolve so a TRACELANE_MODE / TRACELANE_OUT_DIR set during the run is
    // reflected in the summary.
    this.resolved = resolveOptions(this.opts);
    const { mode, outDir } = this.resolved;
    const reported = mode === 'all' ? this.total : this.failed;
    console.log(
      `[tracelane/playwright] mode=${mode} — wrote ${reported} report(s) for ${this.failed} failed / ${this.total} test(s) → ${outDir}`,
    );
  }
}

export default TraceLaneReporter;
