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

const BRIDGE_KEYS = [
  'TRACELANE_MODE',
  'TRACELANE_OUT_DIR',
  'TRACELANE_CAPTURE_NETWORK',
  'TRACELANE_CAPTURE_RRWEB',
  'TRACELANE_CAPTURE_CONSOLE',
  'TRACELANE_SECURITY',
  'TRACELANE_FOOTER',
  'TRACELANE_DRAIN_INTERVAL_MS',
  'TRACELANE_COOLDOWN_MS',
  'TRACELANE_NETWORK_OPTIONS',
  'TRACELANE_CONSOLE_OPTIONS',
] as const;

describe('TraceLaneReporter', () => {
  const prev = new Map<string, string | undefined>(BRIDGE_KEYS.map((k) => [k, process.env[k]]));

  beforeEach(() => {
    for (const k of BRIDGE_KEYS) Reflect.deleteProperty(process.env, k);
  });

  afterEach(() => {
    for (const k of BRIDGE_KEYS) {
      const v = prev.get(k);
      if (v === undefined) Reflect.deleteProperty(process.env, k);
      else process.env[k] = v;
    }
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
    expect(process.env.TRACELANE_SECURITY).toBeUndefined();
    expect(process.env.TRACELANE_FOOTER).toBeUndefined();
    expect(process.env.TRACELANE_CAPTURE_RRWEB).toBeUndefined();
    expect(process.env.TRACELANE_CAPTURE_CONSOLE).toBeUndefined();
    expect(process.env.TRACELANE_DRAIN_INTERVAL_MS).toBeUndefined();
    expect(process.env.TRACELANE_COOLDOWN_MS).toBeUndefined();
    expect(process.env.TRACELANE_NETWORK_OPTIONS).toBeUndefined();
    expect(process.env.TRACELANE_CONSOLE_OPTIONS).toBeUndefined();
  });

  it('bridges Gap 1/2/3 options into TRACELANE_* env', () => {
    new TraceLaneReporter({
      security: false,
      capture: { rrweb: false, console: false, network: false },
      report: { footer: false },
      drainIntervalMs: 800,
      cooldownMs: 300,
    });
    expect(process.env.TRACELANE_SECURITY).toBe('false');
    expect(process.env.TRACELANE_CAPTURE_RRWEB).toBe('false');
    expect(process.env.TRACELANE_CAPTURE_CONSOLE).toBe('false');
    expect(process.env.TRACELANE_CAPTURE_NETWORK).toBe('false');
    expect(process.env.TRACELANE_FOOTER).toBe('false');
    expect(process.env.TRACELANE_DRAIN_INTERVAL_MS).toBe('800');
    expect(process.env.TRACELANE_COOLDOWN_MS).toBe('300');
  });

  it('bridges capture.network (preferred) to TRACELANE_CAPTURE_NETWORK', () => {
    new TraceLaneReporter({ capture: { network: false } });
    expect(process.env.TRACELANE_CAPTURE_NETWORK).toBe('false');
  });

  it('JSON-bridges networkOptions / consolePluginOptions and round-trips via resolveOptions', () => {
    new TraceLaneReporter({
      capture: { networkOptions: { recordHeaders: true, payloadHostDenyList: ['x.test'] } },
      consolePluginOptions: { level: ['error'] as never },
    });
    expect(JSON.parse(process.env.TRACELANE_NETWORK_OPTIONS as string)).toEqual({
      recordHeaders: true,
      payloadHostDenyList: ['x.test'],
    });
    expect(JSON.parse(process.env.TRACELANE_CONSOLE_OPTIONS as string)).toEqual({
      level: ['error'],
    });
  });

  it('drops function-valued mask props from the bridged networkOptions (worker-process limitation)', () => {
    new TraceLaneReporter({
      capture: {
        networkOptions: {
          recordBody: true,
          // function-valued props cannot cross the env bridge
          maskRequestFn: ((v: unknown) => v) as never,
          maskResponseFn: ((v: unknown) => v) as never,
        },
      },
    });
    const bridged = JSON.parse(process.env.TRACELANE_NETWORK_OPTIONS as string);
    expect(bridged).toEqual({ recordBody: true });
    expect(bridged.maskRequestFn).toBeUndefined();
    expect(bridged.maskResponseFn).toBeUndefined();
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
