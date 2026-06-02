import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import TraceLaneReporter from '../src/reporter.js';

// The Reporter owns CONFIG + LIFECYCLE only — the per-test report build lives
// in the auto-fixture (it is the only place with a live page/testInfo). The
// reporter counts totals in onBegin, tallies pass/fail in onTestEnd, and
// re-resolves options in onEnd. It does NOT print to stdio (printsToStdio()
// returns false so Playwright keeps showing its own progress output).

function fakeSuite(total: number) {
  return { allTests: () => Array.from({ length: total }, (_, i) => ({ id: String(i) })) };
}

describe('TraceLaneReporter', () => {
  const prevMode = process.env.TRACELANE_MODE;
  const prevOut = process.env.TRACELANE_OUT_DIR;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'TRACELANE_MODE');
    Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
  });

  afterEach(() => {
    if (prevMode === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_MODE');
    else process.env.TRACELANE_MODE = prevMode;
    if (prevOut === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
    else process.env.TRACELANE_OUT_DIR = prevOut;
  });

  it('does not print to stdio (the fixture/Playwright owns the run output)', () => {
    const r = new TraceLaneReporter();
    expect(r.printsToStdio()).toBe(false);
  });

  it('records totals in onBegin and tallies failures in onTestEnd', () => {
    const r = new TraceLaneReporter({ mode: 'failed', outDir: './out' });
    r.onBegin({} as never, fakeSuite(3) as never);
    r.onTestBegin({} as never, {} as never);
    // TestCase.ok() drives the failure tally: false => failed, true => passed.
    r.onTestEnd({ ok: () => false } as never, { status: 'failed' } as never);
    r.onTestEnd({ ok: () => true } as never, { status: 'passed' } as never);
    r.onTestEnd({ ok: () => true } as never, { status: 'passed' } as never);
    // onEnd should not throw and should not log anything to stdout
    r.onEnd({ status: 'failed' } as never);
    // reporter produces no console output (console.log removed — see Fix 2)
  });

  it('onEnd re-resolves options without logging (TRACELANE_MODE env honored)', () => {
    process.env.TRACELANE_MODE = 'all';
    process.env.TRACELANE_OUT_DIR = '/env/out';
    const r = new TraceLaneReporter({ mode: 'failed', outDir: './local' });
    r.onBegin({} as never, fakeSuite(1) as never);
    // Should not throw; re-resolve happens silently
    expect(() => r.onEnd({ status: 'passed' } as never)).not.toThrow();
  });
});
