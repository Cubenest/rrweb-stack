// Normalize the per-framework test-result shape (P1 PRD §A.2).
//
// Mocha & Jasmine deliver `afterTest(test, context, result)` where
// `result = { error?, result?, duration, passed, retries }`. Cucumber has no
// `afterTest`; it delivers `afterScenario(world, result)` where the outcome
// lives on a `World` object (`world.result.status` / `.message`) and/or a
// `PickleResult` (`{ passed, error, duration }`). We switch on the configured
// framework and collapse all of them to one neutral shape the report builder
// consumes (ReportStatus + error string + duration).

import type { ReportStatus } from '@tracelane/report';

/** The WDIO test frameworks tracelane recognizes (P1 PRD §A.2). */
export type Framework = 'mocha' | 'jasmine' | 'cucumber';

/** Framework-neutral outcome derived from a per-framework result object. */
export interface NormalizedResult {
  /** Whether the test/scenario passed. */
  passed: boolean;
  /** Report status string for the metadata header. */
  status: ReportStatus;
  /** Failure message, when failed/broken. */
  error?: string;
  /** Duration in milliseconds, when the framework reported one. */
  durationMs?: number;
}

/** Mocha/Jasmine `afterTest` result (P1 PRD §A.1). */
interface MochaJasmineResult {
  error?: unknown;
  passed?: boolean;
  duration?: number;
  skipped?: boolean;
}

/** Cucumber `World` (`@wdio/types` `Frameworks.World`). */
interface CucumberWorld {
  result?: {
    status?: string;
    message?: string;
    duration?: { seconds: number; nanos: number };
  };
}

/** Cucumber `PickleResult` (`{ passed, error, duration }`). */
interface PickleResult {
  passed?: boolean;
  error?: string;
  duration?: number;
}

/** Coerce an unknown error-ish value into a single-line message string. */
function errorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.stack ?? error.message;
  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  const stack = (error as { stack?: unknown }).stack;
  if (typeof stack === 'string') return stack;
  return String(error);
}

/** Build a NormalizedResult, mapping `passed`/`skipped` to a ReportStatus. */
function fromPassed(
  passed: boolean,
  opts: {
    error?: string | undefined;
    durationMs?: number | undefined;
    skipped?: boolean | undefined;
  },
): NormalizedResult {
  const status: ReportStatus = opts.skipped
    ? 'skipped'
    : passed
      ? 'passed'
      : // A failure with an assertion message is 'failed'; one without (e.g. a
        // thrown non-assertion error) is 'broken' in the Allure-style taxonomy.
        opts.error
        ? 'failed'
        : 'broken';
  const result: NormalizedResult = { passed, status };
  if (opts.error !== undefined) result.error = opts.error;
  if (opts.durationMs !== undefined) result.durationMs = opts.durationMs;
  return result;
}

/** Normalize a Mocha/Jasmine `afterTest` result. */
function normalizeMochaJasmine(result: MochaJasmineResult): NormalizedResult {
  const passed = result.passed === true;
  return fromPassed(passed, {
    error: errorMessage(result.error),
    durationMs: typeof result.duration === 'number' ? result.duration : undefined,
    skipped: result.skipped === true,
  });
}

/**
 * Normalize a Cucumber outcome. Cucumber's `afterScenario(world, result)` passes
 * both a `World` (rich `result.status`/`message`) and a `PickleResult`
 * (`{ passed, error }`); we read whichever is populated, preferring the explicit
 * `PickleResult.passed` and falling back to `World.result.status`.
 */
function normalizeCucumber(world: CucumberWorld, result?: PickleResult): NormalizedResult {
  const cukeStatus = world.result?.status?.toUpperCase();
  const skipped = cukeStatus === 'SKIPPED' || cukeStatus === 'PENDING';
  // Prefer the PickleResult.passed flag; otherwise derive from the World status.
  const passed = result?.passed !== undefined ? result.passed === true : cukeStatus === 'PASSED';
  const durationMs = world.result?.duration
    ? world.result.duration.seconds * 1000 + world.result.duration.nanos / 1e6
    : typeof result?.duration === 'number'
      ? result.duration
      : undefined;
  return fromPassed(passed, {
    error: result?.error ?? world.result?.message,
    durationMs,
    skipped,
  });
}

/**
 * Normalize a test outcome across frameworks (P1 PRD §A.2). Switch on the
 * `framework` from `wdio.conf`. The two positional args map to the hook
 * signatures: Mocha/Jasmine call with `(result)`; Cucumber with `(world, result)`.
 */
export function normalizeResult(
  framework: Framework | string | undefined,
  a: unknown,
  b?: unknown,
): NormalizedResult {
  if (framework === 'cucumber') {
    return normalizeCucumber((a ?? {}) as CucumberWorld, b as PickleResult | undefined);
  }
  // mocha, jasmine, and any unknown framework all use the afterTest result shape.
  return normalizeMochaJasmine((a ?? {}) as MochaJasmineResult);
}
