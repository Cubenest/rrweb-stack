import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TraceLaneReporter from '../src/reporter.js';

// The Reporter owns CONFIG + SUMMARY only — the per-test report build lives in
// the auto-fixture (it is the only place with a live page/testInfo). So the
// reporter must NOT touch `page`; it counts totals in onBegin, tallies
// pass/fail in onTestEnd, and prints a one-line summary in onEnd. It reads
// resolveOptions(this._opts) so the summary reflects mode/outDir + env override.

function fakeSuite(total: number) {
  return { allTests: () => Array.from({ length: total }, (_, i) => ({ id: String(i) })) };
}

describe('TraceLaneReporter', () => {
  const prevMode = process.env.TRACELANE_MODE;
  const prevOut = process.env.TRACELANE_OUT_DIR;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'TRACELANE_MODE');
    Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (prevMode === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_MODE');
    else process.env.TRACELANE_MODE = prevMode;
    if (prevOut === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
    else process.env.TRACELANE_OUT_DIR = prevOut;
  });

  it('does not print to stdio (the fixture/Playwright owns the run output)', () => {
    const r = new TraceLaneReporter();
    expect(r.printsToStdio()).toBe(false);
  });

  it('records totals in onBegin and tallies failures in onTestEnd; summary in onEnd', () => {
    const r = new TraceLaneReporter({ mode: 'failed', outDir: './out' });
    r.onBegin({} as never, fakeSuite(3) as never);
    r.onTestBegin({} as never, {} as never);
    // TestCase.ok() drives the failure tally: false => failed, true => passed.
    r.onTestEnd({ ok: () => false } as never, { status: 'failed' } as never);
    r.onTestEnd({ ok: () => true } as never, { status: 'passed' } as never);
    r.onTestEnd({ ok: () => true } as never, { status: 'passed' } as never);
    r.onEnd({ status: 'failed' } as never);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/tracelane/i);
    expect(printed).toContain('./out');
    // one failing test of three
    expect(printed).toMatch(/1\b/);
  });

  it('honors TRACELANE_MODE / TRACELANE_OUT_DIR env overrides in the summary', () => {
    process.env.TRACELANE_MODE = 'all';
    process.env.TRACELANE_OUT_DIR = '/env/out';
    const r = new TraceLaneReporter({ mode: 'failed', outDir: './local' });
    r.onBegin({} as never, fakeSuite(1) as never);
    r.onEnd({ status: 'passed' } as never);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('/env/out');
    expect(printed).toMatch(/all/);
  });
});
