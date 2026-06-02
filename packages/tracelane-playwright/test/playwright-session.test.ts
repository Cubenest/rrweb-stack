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

interface FakePage {
  evaluate: ReturnType<typeof vi.fn>;
  context: () => {
    addInitScript: ReturnType<typeof vi.fn>;
    browser: () => { browserType: () => { name: () => string } };
    newCDPSession: ReturnType<typeof vi.fn>;
  };
}

function fakePage(events: unknown[], browserName = 'chromium'): FakePage {
  const addInitScript = vi.fn(async () => {});
  const newCDPSession = vi.fn(async () => ({
    send: vi.fn(async () => ({})),
    on: vi.fn(),
    detach: vi.fn(async () => {}),
  }));
  const context = () => ({
    addInitScript,
    browser: () => ({ browserType: () => ({ name: () => browserName }) }),
    newCDPSession,
  });
  let drained = false;
  const evaluate = vi.fn(async (_pageFn: unknown, arg: unknown) => {
    const body =
      typeof (arg as { body?: unknown })?.body === 'string' ? (arg as { body: string }).body : '';
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
  return { evaluate, context };
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
