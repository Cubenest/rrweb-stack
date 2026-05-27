import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { traceLaneHooks } from '../src/hooks';
import type { WdioBrowser } from '../src/wdio-executor';

// The hook-factory alternative (Task 2.15 / ADR-0004 / P1 PRD §M.2): the same
// capture logic exposed as standalone wdio.conf hook functions.

const bundleBuilt = existsSync(join(__dirname, '..', 'dist', 'rrweb-bundle.js'));

function mockBrowser(): WdioBrowser & { capabilities: Record<string, string> } {
  return {
    capabilities: { browserName: 'chrome', browserVersion: '124.0' },
    execute: vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args)),
    executeAsync: vi.fn(async () => undefined),
    cdp: vi.fn(async () => {
      throw new Error('no cdp');
    }),
    on: vi.fn(() => undefined),
  };
}

describe('traceLaneHooks — surface', () => {
  it('returns the full documented hook surface (P1 PRD §M.2)', () => {
    const hooks = traceLaneHooks({ mode: 'failed' });
    for (const name of [
      'beforeSession',
      'before',
      'beforeSuite',
      'beforeTest',
      'beforeCommand',
      'afterTest',
      'afterSuite',
      'after',
      'onComplete',
    ] as const) {
      expect(typeof hooks[name]).toBe('function');
    }
  });

  it('the no-op hooks do not throw', () => {
    const hooks = traceLaneHooks();
    expect(() => hooks.beforeSuite({} as never)).not.toThrow();
    expect(() => hooks.afterSuite({} as never)).not.toThrow();
    expect(() => hooks.beforeSession({}, {}, [], '0-0')).not.toThrow();
    expect(() => hooks.onComplete(0, {}, {}, {})).not.toThrow();
  });
});

describe.skipIf(!bundleBuilt)('traceLaneHooks — capture flow', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = join(tmpdir(), `tl-hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const w = window as unknown as Record<string, unknown>;
    w.__tracelane__events = undefined;
    w.__tracelane__inited = undefined;
    w.__tracelane__sessionId = undefined;
    w.__tracelane__stop = undefined;
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes a report on a failing test via the bound hooks', async () => {
    const hooks = traceLaneHooks({ mode: 'failed', outDir, framework: 'mocha' });
    const browser = mockBrowser();
    hooks.beforeSession({}, {}, [], '2-0');
    await hooks.before({}, [], browser as unknown as WebdriverIO.Browser);
    await hooks.beforeTest({ title: 'fails', file: 'test/h.spec.ts' } as never, undefined);
    (window as unknown as { __tracelane__events?: unknown[] }).__tracelane__events = [
      { type: 4, data: { href: 'https://app.test', width: 800, height: 600 }, timestamp: 1 },
    ];
    await hooks.afterTest({} as never, undefined, {
      passed: false,
      duration: 12,
      error: new Error('boom'),
    } as never);
    expect(existsSync(outDir)).toBe(true);
  });
});
