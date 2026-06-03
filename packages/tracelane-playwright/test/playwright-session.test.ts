import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runFinalize, runStart, runTracelaneSession } from '../src/playwright-session.js';

// Drives the full inject → start → finalize → write path with a mocked
// Playwright Page. The fake page.evaluate runs the recorder's serialized
// page-scripts the way Playwright does (single packed arg) and distinguishes:
//   - the init script (body has `__tracelane__inited`) → returns a session id
//   - the drain script (body has `__tracelane__events` but NOT `__tracelane__inited`)
//     → returns the canned events ONCE, then [].
// addInitScript is recorded; the browser is chromium-shaped but with
// captureNetwork off (CDP is exercised in Task 9).

interface FakeCdp {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
}

interface FakeContext {
  addInitScript: ReturnType<typeof vi.fn>;
  browser: () => { browserType: () => { name: () => string } };
  newCDPSession: ReturnType<typeof vi.fn>;
}

interface FakePage {
  evaluate: ReturnType<typeof vi.fn>;
  context: () => FakeContext;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  mainFrame: () => { url: () => string };
  // Test-only handles (not part of the Playwright Page surface).
  _ctx: FakeContext;
  _lastCdp: () => FakeCdp | undefined;
  _fireNav: (frame: unknown) => void;
  _mainFrame: { url: () => string };
}

interface FakePageOptions {
  browserName?: string;
  /** Reject the CDP `Network.enable` send so attachNetworkCapture throws after CDP opened. */
  cdpEnableThrows?: boolean;
  /** Reject the bundle-injection evaluate so recorder.start() throws after CDP opened. */
  startThrows?: boolean;
}

function fakePage(events: unknown[], opts: FakePageOptions = {}): FakePage {
  const { browserName = 'chromium', cdpEnableThrows = false, startThrows = false } = opts;
  const addInitScript = vi.fn(async () => {});
  let lastCdp: FakeCdp | undefined;
  const newCDPSession = vi.fn(async () => {
    lastCdp = {
      send: vi.fn(async (method: string) => {
        if (cdpEnableThrows && method === 'Network.enable') {
          throw new Error('CDP Network.enable failed');
        }
        return {};
      }),
      on: vi.fn(),
      detach: vi.fn(async () => {}),
    };
    return lastCdp;
  });
  // A STABLE context object so call assertions survive multiple context() reads.
  const ctx: FakeContext = {
    addInitScript,
    browser: () => ({ browserType: () => ({ name: () => browserName }) }),
    newCDPSession,
  };
  let drained = false;
  const evaluate = vi.fn(async (_pageFn: unknown, arg: unknown) => {
    const body =
      typeof (arg as { body?: unknown })?.body === 'string' ? (arg as { body: string }).body : '';
    // The recorder's start() first injects the bundle via execute(injectBundleScript,
    // rrwebBundle): that fn body evals the bundle and contains neither marker. Make
    // it throw to simulate recorder.start() failing AFTER the CDP session opened.
    if (
      startThrows &&
      !body.includes('__tracelane__events') &&
      !body.includes('__tracelane__inited')
    ) {
      throw new Error('recorder.start() failed (bundle injection)');
    }
    // Drain: reads the in-page events buffer but is NOT the init routine.
    if (body.includes('__tracelane__events') && !body.includes('__tracelane__inited')) {
      if (drained) return [];
      drained = true;
      return events.slice();
    }
    // Init routine returns the active session id (a monotonic number).
    if (body.includes('__tracelane__inited')) return 1;
    // Bundle injection (eval) and anything else: undefined.
    return undefined;
  });
  // --- navigation plumbing (Task 1) ---
  const mainFrame = { url: () => 'https://example.test/page-b' };
  const navHandlers: Array<(frame: unknown) => void> = [];
  const on = vi.fn((event: string, h: (frame: unknown) => void) => {
    if (event === 'framenavigated') navHandlers.push(h);
  });
  const off = vi.fn();
  return {
    evaluate,
    context: () => ctx,
    on,
    off,
    mainFrame: () => mainFrame,
    _ctx: ctx,
    _lastCdp: () => lastCdp,
    _fireNav: (frame: unknown) => {
      for (const h of navHandlers) h(frame);
    },
    _mainFrame: mainFrame,
  };
}

const RRWEB_STUB =
  'window.rrweb={record:function(){return function(){}},getRecordConsolePlugin:function(){return {}},getRecordNetworkPlugin:function(){return {}}}';

function failedTestInfo() {
  return {
    status: 'failed',
    expectedStatus: 'passed',
    title: 't',
    titlePath: ['chromium', '/x/login.spec.ts', 's', 't'],
    file: '/x/login.spec.ts',
    error: { message: 'boom', stack: 'Error: boom\n  at x' },
    duration: 5,
    project: { name: 'chromium' },
  };
}

function passedTestInfo() {
  return {
    status: 'passed',
    expectedStatus: 'passed',
    title: 't',
    titlePath: ['chromium', '/x/a.spec.ts', 't'],
    file: '/x/a.spec.ts',
    duration: 1,
    project: { name: 'chromium' },
  };
}

describe('runTracelaneSession', () => {
  it('writes a report on failure (failed mode) and injects the bundle', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tl-pw-'));
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }]);
    await runTracelaneSession({
      page: page as never,
      testInfo: failedTestInfo() as never,
      options: { mode: 'failed', outDir, captureNetwork: false },
      rrwebBundle: RRWEB_STUB,
    });
    const files = readdirSync(outDir).filter((f) => f.endsWith('.html'));
    expect(files.length).toBe(1);
    // The bundle is injected on the context for fresh-page coverage.
    expect(page.context().addInitScript).toBeDefined();
  });

  it('writes nothing on pass (failed mode)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tl-pw-'));
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }]);
    await runTracelaneSession({
      page: page as never,
      testInfo: passedTestInfo() as never,
      options: { mode: 'failed', outDir, captureNetwork: false },
      rrwebBundle: RRWEB_STUB,
    });
    expect(readdirSync(outDir).filter((f) => f.endsWith('.html')).length).toBe(0);
  });

  it("writes a report on a passing test in 'all' mode", async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tl-pw-'));
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }]);
    await runTracelaneSession({
      page: page as never,
      testInfo: passedTestInfo() as never,
      options: { mode: 'all', outDir, captureNetwork: false },
      rrwebBundle: RRWEB_STUB,
    });
    expect(readdirSync(outDir).filter((f) => f.endsWith('.html')).length).toBe(1);
  });
});

describe('runStart + runFinalize (fixture split)', () => {
  it('runStart injects + starts; runFinalize writes on failure', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tl-pw-'));
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }]);
    const options = { mode: 'failed' as const, outDir, captureNetwork: false };
    const session = await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page.context().addInitScript).toHaveBeenCalled();
    await runFinalize(session, {
      page: page as never,
      testInfo: failedTestInfo() as never,
      options,
      rrwebBundle: RRWEB_STUB,
    });
    expect(readdirSync(outDir).filter((f) => f.endsWith('.html')).length).toBe(1);
  });
});

describe('CDP network capture (Chromium-only, opt-in)', () => {
  it('opens a CDP session + enables Network when captureNetwork && chromium', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], { browserName: 'chromium' });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: true,
    };
    await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page._ctx.newCDPSession).toHaveBeenCalledTimes(1);
    // attachNetworkCapture sends Network.enable through the CDP-backed executor.
    expect(page._lastCdp()?.send).toHaveBeenCalledWith('Network.enable', undefined);
    expect(page._lastCdp()?.on).toHaveBeenCalledWith(
      'Network.responseReceived',
      expect.any(Function),
    );
  });

  it('detaches the CDP session at finalize', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], { browserName: 'chromium' });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: true,
    };
    const session = await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    await runFinalize(session, {
      page: page as never,
      testInfo: passedTestInfo() as never,
      options,
      rrwebBundle: RRWEB_STUB,
    });
    expect(page._lastCdp()?.detach).toHaveBeenCalledTimes(1);
  });

  it('does NOT open a CDP session on firefox', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], { browserName: 'firefox' });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: true,
    };
    await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page._ctx.newCDPSession).not.toHaveBeenCalled();
  });

  it('does NOT open a CDP session on webkit', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], { browserName: 'webkit' });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: true,
    };
    await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page._ctx.newCDPSession).not.toHaveBeenCalled();
  });

  it('does NOT open a CDP session when captureNetwork is false (even on chromium)', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], { browserName: 'chromium' });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: false,
    };
    await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page._ctx.newCDPSession).not.toHaveBeenCalled();
  });

  it('degrades to rrweb-only (no throw) when attachNetworkCapture fails, detaching CDP', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], {
      browserName: 'chromium',
      cdpEnableThrows: true,
    });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: true,
    };
    const session = await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page._ctx.newCDPSession).toHaveBeenCalledTimes(1);
    expect(page._lastCdp()?.detach).toHaveBeenCalledTimes(1); // failed attach → detach
    expect(session.disabled).toBeFalsy(); // rrweb still recording
    expect(session.cdp).toBeUndefined(); // no live CDP on the session
  });

  it('disables capture (no throw, no report) when recorder.start() fails (e.g. CSP)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], {
      browserName: 'chromium',
      startThrows: true,
    });
    const outDir = mkdtempSync(join(tmpdir(), 'tl-pw-'));
    const options = { mode: 'failed' as const, outDir, captureNetwork: true };
    const session = await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(session.disabled).toBe(true);
    expect(page._lastCdp()?.detach).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    // A disabled session writes nothing on finalize.
    await runFinalize(session, {
      page: page as never,
      testInfo: failedTestInfo() as never,
      options,
      rrwebBundle: RRWEB_STUB,
    });
    expect(readdirSync(outDir).filter((f) => f.endsWith('.html')).length).toBe(0);
    warn.mockRestore();
  });
});

describe('navigation reinject (Task 1)', () => {
  it('reinjects on main-frame navigation and ignores sub-frames', async () => {
    const page = fakePage([{ type: 4, data: {}, timestamp: 1 }], { browserName: 'chromium' });
    const options = {
      mode: 'failed' as const,
      outDir: mkdtempSync(join(tmpdir(), 'tl-pw-')),
      captureNetwork: false,
    };
    const session = await runStart({ page: page as never, options, rrwebBundle: RRWEB_STUB });
    expect(page.on).toHaveBeenCalledWith('framenavigated', expect.any(Function));

    const before = page.evaluate.mock.calls.length;
    page._fireNav(page._mainFrame); // main frame
    await new Promise((r) => setTimeout(r, 0));
    expect(page.evaluate.mock.calls.length).toBeGreaterThan(before);

    const afterMain = page.evaluate.mock.calls.length;
    page._fireNav({ url: () => 'https://sub.frame/x' }); // not the main frame
    await new Promise((r) => setTimeout(r, 0));
    expect(page.evaluate.mock.calls.length).toBe(afterMain);

    await runFinalize(session, {
      page: page as never,
      testInfo: failedTestInfo() as never,
      options,
      rrwebBundle: RRWEB_STUB,
    });
    expect(page.off).toHaveBeenCalledWith('framenavigated', expect.any(Function));
  });
});
