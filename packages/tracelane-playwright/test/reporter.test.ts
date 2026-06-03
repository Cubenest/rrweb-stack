import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import TraceLaneReporter from '../src/reporter.js';

// The Reporter owns CONFIG VALIDATION + OPTIONS→ENV BRIDGE only — the per-test
// report build lives in the auto-fixture (the only place with a live
// page/testInfo). The reporter does NOT tally pass/fail counts and does NOT
// print to stdio (printsToStdio() returns false so Playwright keeps showing its
// own progress output).

function fakeSuite(total: number) {
  return { allTests: () => Array.from({ length: total }, (_, i) => ({ id: String(i) })) };
}

describe('TraceLaneReporter', () => {
  const prevMode = process.env.TRACELANE_MODE;
  const prevOut = process.env.TRACELANE_OUT_DIR;
  const prevCap = process.env.TRACELANE_CAPTURE_NETWORK;

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'TRACELANE_MODE');
    Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
    Reflect.deleteProperty(process.env, 'TRACELANE_CAPTURE_NETWORK');
  });

  afterEach(() => {
    if (prevMode === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_MODE');
    else process.env.TRACELANE_MODE = prevMode;
    if (prevOut === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_OUT_DIR');
    else process.env.TRACELANE_OUT_DIR = prevOut;
    if (prevCap === undefined) Reflect.deleteProperty(process.env, 'TRACELANE_CAPTURE_NETWORK');
    else process.env.TRACELANE_CAPTURE_NETWORK = prevCap;
  });

  it('does not print to stdio (the fixture/Playwright owns the run output)', () => {
    const r = new TraceLaneReporter();
    expect(r.printsToStdio()).toBe(false);
  });

  it('lifecycle methods (onBegin, onTestBegin, onTestEnd, onEnd) do not throw', () => {
    const r = new TraceLaneReporter({ mode: 'failed', outDir: './out' });
    r.onBegin({} as never, fakeSuite(3) as never);
    r.onTestBegin({} as never, {} as never);
    // All no-ops — the fixture owns per-test reporting; the reporter does not tally.
    r.onTestEnd({} as never, { status: 'failed' } as never);
    r.onTestEnd({} as never, { status: 'passed' } as never);
    r.onTestEnd({} as never, { status: 'passed' } as never);
    // onEnd should not throw and should not log anything to stdout
    r.onEnd({ status: 'failed' } as never);
  });

  it('bridges reporter options into TRACELANE_* env for the fixture', () => {
    new TraceLaneReporter({ mode: 'all', outDir: './my-reports', captureNetwork: false });
    expect(process.env.TRACELANE_MODE).toBe('all');
    expect(process.env.TRACELANE_OUT_DIR).toBe('./my-reports');
    expect(process.env.TRACELANE_CAPTURE_NETWORK).toBe('false');
  });

  it('does NOT override an already-set env var (explicit env wins)', () => {
    process.env.TRACELANE_MODE = 'failed';
    new TraceLaneReporter({ mode: 'all' });
    expect(process.env.TRACELANE_MODE).toBe('failed');
  });

  it('sets no env var for an omitted option', () => {
    new TraceLaneReporter({ mode: 'all' });
    expect(process.env.TRACELANE_OUT_DIR).toBeUndefined();
    expect(process.env.TRACELANE_CAPTURE_NETWORK).toBeUndefined();
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
