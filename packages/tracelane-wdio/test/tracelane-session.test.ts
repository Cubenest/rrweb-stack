import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TraceLaneSession } from '../src/tracelane-session';
import type { WdioBrowser } from '../src/wdio-executor';

// End-to-end of the Node-side decision logic (Task 2.14 / ADR-0005): the
// afterTest mode + report-write decision, with a mocked WDIO `browser`.
//
// The mock `browser.execute` runs the serialized page-script fns against jsdom's
// `window` (mirroring core's own recorder tests), so the real createRecorder /
// in-page buffer path runs — only the network CDP path is stubbed out.

const bundleBuilt = existsSync(join(__dirname, '..', 'dist', 'rrweb-bundle.js'));

type MockBrowser = WdioBrowser & { capabilities: Record<string, string> };

function mockBrowser(opts: { cdpWorks?: boolean } = {}): MockBrowser {
  return {
    capabilities: { browserName: 'chrome', browserVersion: '124.0.0.0' },
    // Run the page-script fn in-process against jsdom's window.
    execute: vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args)),
    executeAsync: vi.fn(async () => undefined),
    // By default no CDP in unit tests — the session degrades to rrweb-only
    // capture; pass { cdpWorks: true } to simulate a CDP-capable session.
    cdp: vi.fn(async () => {
      if (!opts.cdpWorks) throw new Error('no cdp in unit test');
      return undefined;
    }),
    on: vi.fn(() => undefined),
  };
}

function seedPageBuffer(events: unknown[]): void {
  (window as unknown as { __tracelane__events?: unknown[] }).__tracelane__events = events;
}

function resetPageState(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__tracelane__events = undefined;
  w.__tracelane__inited = undefined;
  w.__tracelane__sessionId = undefined;
  w.__tracelane__stop = undefined;
}

/** The console-plugin options the recorder's init script was called with, if any. */
function consoleOptionsFromExecuteCalls(browser: MockBrowser): unknown {
  // runInit() calls execute(tracelaneInitScript, cooldownMs:number, consoleOptions, networkOptions?).
  const calls = (browser.execute as ReturnType<typeof vi.fn>).mock.calls;
  const initCall = calls.find((c) => typeof c[1] === 'number' && c.length >= 3);
  return initCall?.[2];
}

/** The network-plugin options the recorder's init script was called with, if any. */
function networkOptionsFromExecuteCalls(browser: MockBrowser): unknown {
  // The 4th positional arg to execute(initScript, cooldownMs, consoleOpts, networkOpts).
  const calls = (browser.execute as ReturnType<typeof vi.fn>).mock.calls;
  const initCall = calls.find((c) => typeof c[1] === 'number' && c.length >= 4);
  return initCall?.[3];
}

describe.skipIf(!bundleBuilt)('TraceLaneSession — afterTest report-write decision', () => {
  let outDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    outDir = join(tmpdir(), `tl-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    resetPageState();
    // These tests use the throwing-cdp mock, so the session warns once about
    // degraded network capture (covered by its own suite); silence the noise.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
  });

  it('failed mode: a passing test writes no report and discards the buffer', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a passing test', 'test/pass.spec.ts');
    seedPageBuffer([{ type: 3, data: {}, timestamp: 1 }]);
    const path = await session.onAfterTest({ passed: true, duration: 10 });
    expect(path).toBeUndefined();
    expect(existsSync(outDir)).toBe(false);
  });

  it('failed mode: a failing test writes one .html report', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a failing test', 'test/fail.spec.ts');
    seedPageBuffer([
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
      { type: 2, data: { node: {}, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
    ]);
    const path = await session.onAfterTest({
      passed: false,
      duration: 99,
      error: new Error('expected visible'),
    });
    expect(path).toBeDefined();
    expect(path?.endsWith('.html')).toBe(true);
    expect(existsSync(path as string)).toBe(true);
    // Filename is namespaced by spec, title, and cid.
    const files = readdirSync(outDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/fail--a-failing-test--0-0-\d+\.html/);
  });

  it('all mode: a passing test still writes a report', async () => {
    const session = new TraceLaneSession({ mode: 'all', outDir }, 'mocha', '1-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a passing test', 'test/pass.spec.ts');
    seedPageBuffer([
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
    ]);
    const path = await session.onAfterTest({ passed: true, duration: 10 });
    expect(path).toBeDefined();
    expect(existsSync(path as string)).toBe(true);
  });

  it('TRACELANE_MODE=all env var overrides failed config for a passing test', async () => {
    vi.stubEnv('TRACELANE_MODE', 'all');
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a passing test', 'test/pass.spec.ts');
    seedPageBuffer([
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
    ]);
    const path = await session.onAfterTest({ passed: true, duration: 10 });
    expect(path).toBeDefined();
  });

  it('capture.rrweb=false produces no recorder and no report even on failure', async () => {
    const session = new TraceLaneSession({ outDir, capture: { rrweb: false } }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a failing test', 'test/fail.spec.ts');
    const path = await session.onAfterTest({ passed: false, error: new Error('x') });
    expect(path).toBeUndefined();
    expect(existsSync(outDir)).toBe(false);
  });

  it('the report metadata carries the browser name/version from capabilities', async () => {
    const session = new TraceLaneSession({ mode: 'all', outDir }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('meta test', 'test/meta.spec.ts');
    seedPageBuffer([
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
    ]);
    const path = (await session.onAfterTest({ passed: true, duration: 5 })) as string;
    const html = readFileSync(path, 'utf8');
    expect(html).toContain('chrome');
    expect(html).toContain('124.0.0.0');
  });
});

describe.skipIf(!bundleBuilt)('TraceLaneSession — capture.console toggle (#1)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPageState();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('disables console capture by passing { level: [] } to the recorder', async () => {
    const session = new TraceLaneSession({ capture: { console: false } }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a test', 'test/x.spec.ts');
    // The recorder's in-page init was called with an empty console level list,
    // so the rrweb console plugin patches nothing.
    expect(consoleOptionsFromExecuteCalls(browser)).toEqual({ level: [] });
  });

  it('leaves console capture on (no { level: [] }) by default', async () => {
    const session = new TraceLaneSession({}, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a test', 'test/x.spec.ts');
    // Default: the session forwards no console override, so core applies its
    // defaults (which include the standard console levels).
    expect(consoleOptionsFromExecuteCalls(browser)).not.toEqual({ level: [] });
  });

  it('forwards an explicit consolePluginOptions when console capture is on', async () => {
    const custom = { level: ['error'] };
    const session = new TraceLaneSession({ consolePluginOptions: custom }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a test', 'test/x.spec.ts');
    expect(consoleOptionsFromExecuteCalls(browser)).toEqual(custom);
  });
});

describe.skipIf(!bundleBuilt)('TraceLaneSession — network capture degrade (#2)', () => {
  let outDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    outDir = join(tmpdir(), `tl-net-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    resetPageState();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  async function runTestCycle(session: TraceLaneSession, n: number): Promise<void> {
    await session.onBeforeTest(`test ${n}`, 'test/x.spec.ts');
    seedPageBuffer([
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
    ]);
    await session.onAfterTest({ passed: true, duration: 1 });
  }

  it('attempts CDP attach only once across many tests when CDP is unavailable', async () => {
    const session = new TraceLaneSession({ mode: 'all', outDir }, 'mocha', '0-0');
    const browser = mockBrowser({ cdpWorks: false });
    await session.onBefore(browser);
    await runTestCycle(session, 1);
    await runTestCycle(session, 2);
    await runTestCycle(session, 3);
    // cdp('Network','enable') was attempted exactly once, not once per test.
    const cdpCalls = (browser.cdp as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'Network' && c[1] === 'enable',
    );
    expect(cdpCalls).toHaveLength(1);
  });

  it('warns exactly once that network capture is unavailable', async () => {
    const session = new TraceLaneSession({ mode: 'all', outDir }, 'mocha', '0-0');
    const browser = mockBrowser({ cdpWorks: false });
    await session.onBefore(browser);
    await runTestCycle(session, 1);
    await runTestCycle(session, 2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[tracelane/wdio] network capture unavailable (CDP not attached); degrading to rrweb+console only.',
    );
  });

  it('attaches CDP once and does not warn when CDP is available', async () => {
    const session = new TraceLaneSession({ mode: 'all', outDir }, 'mocha', '0-0');
    const browser = mockBrowser({ cdpWorks: true });
    await session.onBefore(browser);
    await runTestCycle(session, 1);
    await runTestCycle(session, 2);
    const cdpCalls = (browser.cdp as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'Network' && c[1] === 'enable',
    );
    expect(cdpCalls).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('skips network capture entirely when capture.network is false', async () => {
    const session = new TraceLaneSession(
      { mode: 'all', outDir, capture: { network: false } },
      'mocha',
      '0-0',
    );
    const browser = mockBrowser({ cdpWorks: false });
    await session.onBefore(browser);
    await runTestCycle(session, 1);
    const cdpCalls = (browser.cdp as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'Network' && c[1] === 'enable',
    );
    expect(cdpCalls).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe.skipIf(!bundleBuilt)('TraceLaneSession — security toggle (Task 13)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPageState();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  /** The CDP event names the session subscribed to via `executor.on(...)`. */
  function registeredCdpEvents(browser: MockBrowser): string[] {
    return (browser.on as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
  }

  it('registers the [tracelane.sec] extra-info listener by default (security on)', async () => {
    const session = new TraceLaneSession({ mode: 'all' }, 'mocha', '0-0');
    const browser = mockBrowser({ cdpWorks: true });
    await session.onBefore(browser);
    await session.onBeforeTest('a test', 'test/x.spec.ts');
    // attachNetworkCapture(executor, { security: true }) registers the
    // sec-only responseReceivedExtraInfo handler.
    expect(registeredCdpEvents(browser)).toContain('Network.responseReceivedExtraInfo');
  });

  it('does NOT register the [tracelane.sec] listener when security:false', async () => {
    const session = new TraceLaneSession({ mode: 'all', security: false }, 'mocha', '0-0');
    const browser = mockBrowser({ cdpWorks: true });
    await session.onBefore(browser);
    await session.onBeforeTest('a test', 'test/x.spec.ts');
    // security:false threads { security: false } to attachNetworkCapture, which
    // then skips the responseReceivedExtraInfo subscription entirely.
    expect(registeredCdpEvents(browser)).not.toContain('Network.responseReceivedExtraInfo');
    // The [tracelane.net] failure path is unaffected — Network.enable still ran.
    const cdpCalls = (browser.cdp as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'Network' && c[1] === 'enable',
    );
    expect(cdpCalls).toHaveLength(1);
  });

  // A page buffer that carries a `tracelane.sec` rrweb Custom event the analyzer
  // turns into findings: HTTPS main document with NO security headers ⇒
  // missing-CSP/HSTS/etc. This is the event the capture layer now injects
  // Node-side (via recorder.addCustomEvent) instead of a page console.error —
  // reliable across navigation. Plus the minimal meta + FullSnapshot events the
  // report renders.
  function seedPageBufferWithSecFinding(): void {
    const meta = {
      url: 'https://app.test/',
      status: 200,
      isMainDocument: true,
      presentSecurityHeaders: [],
      setCookies: [],
    };
    seedPageBuffer([
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
      { type: 2, data: { node: {}, initialOffset: { left: 0, top: 0 } }, timestamp: 2 },
      {
        type: 5, // EventType.Custom
        timestamp: 3,
        data: { tag: 'tracelane.sec', payload: meta },
      },
    ]);
  }

  async function renderReportHtml(security: boolean): Promise<string> {
    const outDir = join(tmpdir(), `tl-sec-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const session = new TraceLaneSession({ mode: 'all', outDir, security }, 'mocha', '0-0');
      const browser = mockBrowser({ cdpWorks: true });
      await session.onBefore(browser);
      await session.onBeforeTest('a test', 'test/sec.spec.ts');
      seedPageBufferWithSecFinding();
      const path = (await session.onAfterTest({ passed: true, duration: 5 })) as string;
      return readFileSync(path, 'utf8');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }

  it('security default (on): the report renders the advisory hygiene section', async () => {
    // The same sec line that produces findings below — with security on, analyze()
    // runs and the markdown carries the advisory section.
    const html = await renderReportHtml(true);
    expect(html).toContain('Security hygiene (advisory)');
  });

  it('security:false: the report omits the advisory hygiene section', async () => {
    // Identical events; with security off, analyze() is skipped and the section
    // is absent. The pair proves the flag flips report behavior.
    const html = await renderReportHtml(false);
    expect(html).not.toContain('Security hygiene (advisory)');
  });
});

describe.skipIf(!bundleBuilt)('TraceLaneSession — capture start failure (CSP)', () => {
  let outDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    outDir = join(tmpdir(), `tl-csp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    resetPageState();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  /**
   * A page whose CSP blocks `'unsafe-eval'`: the recorder's bundle injection
   * (`window.eval(bundle)` via `execute`) throws. Mirrors the real failure mode
   * the Playwright adapter already guards (playwright-session.ts disabled path).
   */
  function cspBrowser(): MockBrowser {
    const browser = mockBrowser();
    (browser.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('EvalError: call to eval() blocked by CSP directive "script-src \'self\'"'),
    );
    return browser;
  }

  it('does not throw out of onBeforeTest when in-page injection fails', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = cspBrowser();
    await session.onBefore(browser);
    // tracelane must NEVER fail the user's test: a start() throw is swallowed.
    await expect(session.onBeforeTest('a test', 'test/x.spec.ts')).resolves.toBeUndefined();
  });

  it('writes no report and does not throw at onAfterTest when capture never started', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = cspBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a failing test', 'test/fail.spec.ts');
    // Even a failing test produces no report — the buffer never started — and
    // afterTest must not re-throw the swallowed injection error.
    const path = await session.onAfterTest({ passed: false, error: new Error('x') });
    expect(path).toBeUndefined();
    expect(existsSync(outDir)).toBe(false);
  });

  it('warns exactly once that capture is unavailable across many tests', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = cspBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('test 1', 'test/x.spec.ts');
    await session.onAfterTest({ passed: false, error: new Error('x') });
    await session.onBeforeTest('test 2', 'test/x.spec.ts');
    await session.onAfterTest({ passed: false, error: new Error('x') });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[tracelane/wdio] capture unavailable');
  });

  it('teardown after a failed start is a safe no-op', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = cspBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a test', 'test/x.spec.ts');
    // No recorder survived the failed start, so teardown must not re-drain.
    await expect(session.onAfter()).resolves.toBeUndefined();
  });
});

describe.skipIf(!bundleBuilt)('TraceLaneSession — no teardown drain (#5)', () => {
  let outDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    outDir = join(tmpdir(), `tl-teardown-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    resetPageState();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('onAfter() after a completed test does not issue another in-page drain', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    await session.onBeforeTest('a passing test', 'test/x.spec.ts');
    seedPageBuffer([{ type: 3, data: {}, timestamp: 1 }]);
    await session.onAfterTest({ passed: true, duration: 1 });

    // The recorder was finalized + dropped by onAfterTest; teardown has nothing
    // to stop, so it must not call browser.execute again.
    const callsBefore = (browser.execute as ReturnType<typeof vi.fn>).mock.calls.length;
    await session.onAfter();
    const callsAfter = (browser.execute as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });

  it('onAfter() with no started test (only onBefore) is a safe no-op', async () => {
    const session = new TraceLaneSession({ mode: 'failed', outDir }, 'mocha', '0-0');
    const browser = mockBrowser();
    await session.onBefore(browser);
    // No onBeforeTest -> no recorder was ever created.
    await session.onAfter();
    expect((browser.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

describe.skipIf(!bundleBuilt)(
  'TraceLaneSession — capture.networkOptions passthrough (Phase 5)',
  () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      resetPageState();
      // The mock browser's cdp() throws by default; silence the "CDP unavailable"
      // warning so these passthrough tests aren't polluted by the legacy path.
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('forwards the network plugin defaults (empty object) when no options are set', async () => {
      // Default capture.network is true and no networkOptions — the session must
      // still register the plugin and pass `{}` so it picks up the plugin's
      // built-in privacy defaults (bodies + headers off).
      const session = new TraceLaneSession({}, 'mocha', '0-0');
      const browser = mockBrowser();
      await session.onBefore(browser);
      await session.onBeforeTest('a test', 'test/x.spec.ts');
      expect(networkOptionsFromExecuteCalls(browser)).toEqual({});
    });

    it('forwards an explicit capture.networkOptions object verbatim', async () => {
      const custom = {
        recordHeaders: true,
        recordBody: ['application/json'],
        payloadHostDenyList: ['analytics.example.com'],
      };
      const session = new TraceLaneSession({ capture: { networkOptions: custom } }, 'mocha', '0-0');
      const browser = mockBrowser();
      await session.onBefore(browser);
      await session.onBeforeTest('a test', 'test/x.spec.ts');
      expect(networkOptionsFromExecuteCalls(browser)).toEqual(custom);
    });

    it('omits networkOptions entirely when capture.network is false', async () => {
      // When the user opts out of network capture, the session must NOT pass
      // a network-options arg — the in-page plugin then stays unregistered and
      // the legacy CDP path remains the only network channel (covered above).
      const session = new TraceLaneSession({ capture: { network: false } }, 'mocha', '0-0');
      const browser = mockBrowser();
      await session.onBefore(browser);
      await session.onBeforeTest('a test', 'test/x.spec.ts');
      expect(networkOptionsFromExecuteCalls(browser)).toBeUndefined();
    });
  },
);
