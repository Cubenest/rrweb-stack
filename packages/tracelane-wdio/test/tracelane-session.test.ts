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

function mockBrowser(): WdioBrowser & { capabilities: Record<string, string> } {
  return {
    capabilities: { browserName: 'chrome', browserVersion: '124.0.0.0' },
    // Run the page-script fn in-process against jsdom's window.
    execute: vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args)),
    executeAsync: vi.fn(async () => undefined),
    // No CDP in unit tests — the session degrades to rrweb-only capture.
    cdp: vi.fn(async () => {
      throw new Error('no cdp in unit test');
    }),
    on: vi.fn(() => undefined),
  };
}

function seedPageBuffer(events: unknown[]): void {
  (window as unknown as { __tracelane__events?: unknown[] }).__tracelane__events = events;
}

describe.skipIf(!bundleBuilt)('TraceLaneSession — afterTest report-write decision', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = join(tmpdir(), `tl-session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Reset any in-page recorder state between tests.
    const w = window as unknown as Record<string, unknown>;
    w.__tracelane__events = undefined;
    w.__tracelane__inited = undefined;
    w.__tracelane__sessionId = undefined;
    w.__tracelane__stop = undefined;
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
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
    expect(files[0]).toMatch(/test-fail--a-failing-test--0-0-\d+\.html/);
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
