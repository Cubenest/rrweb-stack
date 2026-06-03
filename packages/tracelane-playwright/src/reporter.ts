// The Playwright Reporter (P1 PRD §B). Registered in playwright.config.ts as
// `reporter: [['@tracelane/playwright', { mode, outDir }]]`.
//
// IMPORTANT: the Reporter does NOT build reports — the per-test HTML build lives
// in the auto-fixture, which is the only place with a live `page` + `testInfo`.
// By design the Reporter never touches `page`. Its job is config validation
// (resolveOptions in the constructor so invalid config surfaces early), bridging
// options to the fixture via TRACELANE_* env vars, and tallying pass/fail for
// future use.
//
// OPTIONS BRIDGE: reporter constructor options are bridged to the fixture via
// TRACELANE_* env vars (set only when unset, so explicit env still wins). The
// fixture runs in separate Playwright worker processes and reads env vars to
// pick up the reporter's config. Verified: env set here (config load, main
// process) is inherited by workers spawned after.

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
    // Validate up front so an invalid config surfaces early.
    resolveOptions(opts);
    // Bridge reporter options to the fixture, which runs in a SEPARATE worker
    // process and reads only TRACELANE_* env + defaults. We set env only when
    // unset, so an explicit env var / CLI value still wins. Verified: env set
    // here (config load, main process) is inherited by workers spawned after.
    //
    // Access process.env defensively (no hard @types/node dep — mirrors
    // options.ts defaultEnv() pattern). The typed interface lets biome use dot
    // notation (useLiteralKeys rule) while keeping TypeScript strict.
    type BridgeEnv = {
      TRACELANE_MODE?: string;
      TRACELANE_OUT_DIR?: string;
      TRACELANE_CAPTURE_NETWORK?: string;
    };
    const env = (globalThis as { process?: { env?: BridgeEnv } }).process?.env;
    if (env !== undefined) {
      if (opts.mode !== undefined && env.TRACELANE_MODE === undefined) {
        env.TRACELANE_MODE = opts.mode;
      }
      if (opts.outDir !== undefined && env.TRACELANE_OUT_DIR === undefined) {
        env.TRACELANE_OUT_DIR = opts.outDir;
      }
      if (opts.captureNetwork !== undefined && env.TRACELANE_CAPTURE_NETWORK === undefined) {
        env.TRACELANE_CAPTURE_NETWORK = String(opts.captureNetwork);
      }
    }
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
