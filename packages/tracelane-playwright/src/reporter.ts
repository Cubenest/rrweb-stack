// The Playwright Reporter (P1 PRD §B). Registered in playwright.config.ts as
// `reporter: [['@tracelane/playwright', { mode, outDir }]]`.
//
// IMPORTANT: the Reporter does NOT build reports — the per-test HTML build lives
// in the auto-fixture, which is the only place with a live `page` + `testInfo`.
// By design the Reporter never touches `page`. Its two jobs are:
//   1. Config validation: resolveOptions in the constructor so invalid config
//      surfaces early (before any test runs).
//   2. Options→env bridge: reporter constructor options are bridged to the
//      fixture via TRACELANE_* env vars (set only when unset, so explicit env
//      still wins). The fixture runs in separate Playwright worker processes and
//      reads env vars to pick up the reporter's config. Verified: env set here
//      (config load, main process) is inherited by workers spawned after.
//
// The reporter does NOT tally pass/fail counts and does NOT print any
// end-of-run summary. All per-test reporting is handled by the fixture.

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
 * Serialize a JSON-bridgeable option to a string for the env bridge, or
 * `undefined` when there's nothing to bridge. `JSON.stringify` silently drops
 * function-valued props (e.g. network `maskRequestFn` / `maskResponseFn`) —
 * those cannot survive the worker-process env boundary, a documented
 * limitation. Returns `undefined` if the result is empty (`{}`) or fails.
 */
function bridgeJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const json = JSON.stringify(value);
    // `{}` carries no information once functions are stripped — skip it.
    return json === undefined || json === '{}' ? undefined : json;
  } catch {
    return undefined;
  }
}

/**
 * tracelane's Playwright reporter. Pair it with the fixture
 * (`import { test } from '@tracelane/playwright/fixture'`) — the fixture records
 * + writes reports; this reporter validates config at startup and bridges options
 * to the fixture via TRACELANE_* env vars.
 */
export class TraceLaneReporter implements Reporter {
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
      TRACELANE_CAPTURE_RRWEB?: string;
      TRACELANE_CAPTURE_CONSOLE?: string;
      TRACELANE_SECURITY?: string;
      TRACELANE_FOOTER?: string;
      TRACELANE_DRAIN_INTERVAL_MS?: string;
      TRACELANE_COOLDOWN_MS?: string;
      TRACELANE_NETWORK_OPTIONS?: string;
      TRACELANE_CONSOLE_OPTIONS?: string;
    };
    const env = (globalThis as { process?: { env?: BridgeEnv } }).process?.env;
    if (env !== undefined) {
      // Each option is bridged only when its env var is unset, so an explicit
      // env var / CLI value always wins.
      const set = (key: keyof BridgeEnv, value: string | undefined): void => {
        if (value !== undefined && env[key] === undefined) env[key] = value;
      };
      set('TRACELANE_MODE', opts.mode);
      set('TRACELANE_OUT_DIR', opts.outDir);
      // capture.network (preferred) wins over the deprecated top-level captureNetwork.
      const network = opts.capture?.network ?? opts.captureNetwork;
      set('TRACELANE_CAPTURE_NETWORK', network !== undefined ? String(network) : undefined);
      set(
        'TRACELANE_CAPTURE_RRWEB',
        opts.capture?.rrweb !== undefined ? String(opts.capture.rrweb) : undefined,
      );
      set(
        'TRACELANE_CAPTURE_CONSOLE',
        opts.capture?.console !== undefined ? String(opts.capture.console) : undefined,
      );
      set('TRACELANE_SECURITY', opts.security !== undefined ? String(opts.security) : undefined);
      set(
        'TRACELANE_FOOTER',
        opts.report?.footer !== undefined ? String(opts.report.footer) : undefined,
      );
      set(
        'TRACELANE_DRAIN_INTERVAL_MS',
        opts.drainIntervalMs !== undefined ? String(opts.drainIntervalMs) : undefined,
      );
      set(
        'TRACELANE_COOLDOWN_MS',
        opts.cooldownMs !== undefined ? String(opts.cooldownMs) : undefined,
      );
      // JSON-serializable masking options. JSON.stringify naturally drops
      // function-valued props (maskRequestFn / maskResponseFn) — they cannot
      // cross the worker-process env bridge, a documented limitation.
      set('TRACELANE_NETWORK_OPTIONS', bridgeJson(opts.capture?.networkOptions));
      set('TRACELANE_CONSOLE_OPTIONS', bridgeJson(opts.consolePluginOptions));
    }
  }

  /** The fixture + Playwright own the run output; this reporter is silent. */
  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, _suite: Suite): void {
    // No-op: validation and env bridging are done in the constructor.
  }

  onTestBegin(_test: TestCase, _result: TestResult): void {
    // No-op: the fixture starts the recorder per test.
  }

  onTestEnd(_test: TestCase, _result: TestResult): void {
    // No-op: the fixture owns per-test report building; this reporter does not
    // tally pass/fail counts.
  }

  onEnd(_result: FullResult): void {
    // No-op: output removed (printsToStdio() is false; console.log here would
    // confuse Playwright which may add its own terminal reporter). The fixture
    // already wrote report files.
  }
}

export default TraceLaneReporter;
