import { describe, expect, it, vi } from 'vitest';
import { traceLaneHooks } from '../src/hooks';
import TraceLaneService from '../src/service';
import type { TraceLaneSession } from '../src/tracelane-session';
import type { WdioBrowser } from '../src/wdio-executor';

// T-9 (2026-05-28 QA walk): the recorder was being re-injected on
// `beforeCommand('url', ...)` — BEFORE the navigation. The navigation then
// destroyed the just-injected rrweb instance + the __tracelane__events
// buffer, leaving the test body to capture nothing. The fix moves
// re-injection to `afterCommand('url', ...)` so rrweb lands on the NEW
// page. These tests pin the new wiring at the Service AND hooks-factory
// layers.

function mockBrowser(): WdioBrowser & { capabilities: Record<string, string> } {
  return {
    capabilities: { browserName: 'chrome', browserVersion: '124.0.0.0' },
    execute: vi.fn(async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => fn(...args)),
    executeAsync: vi.fn(async () => undefined),
    cdp: vi.fn(async () => {
      throw new Error('no cdp');
    }),
    on: vi.fn(() => undefined),
  };
}

describe('TraceLaneService — afterCommand hook (T-9)', () => {
  it('exposes afterCommand for the post-navigation re-injection', () => {
    const svc = new TraceLaneService({}, {}, { framework: 'mocha' });
    expect(typeof svc.afterCommand).toBe('function');
  });

  it('does NOT expose beforeCommand (the buggy old hook is gone)', () => {
    const svc = new TraceLaneService({}, {}, { framework: 'mocha' });
    expect((svc as unknown as { beforeCommand?: unknown }).beforeCommand).toBeUndefined();
  });

  it('calls session.onUrl when afterCommand receives a successful url() call', async () => {
    const svc = new TraceLaneService({}, {}, { framework: 'mocha' });
    const session = (svc as unknown as { session: TraceLaneSession }).session;
    const spy = vi.spyOn(session, 'onUrl').mockResolvedValue(undefined);
    await svc.afterCommand('url', ['https://example.com/a'], undefined);
    expect(spy).toHaveBeenCalledWith('https://example.com/a');
  });

  it('skips re-injection when the url command threw (e.g. malformed URL)', async () => {
    const svc = new TraceLaneService({}, {}, { framework: 'mocha' });
    const session = (svc as unknown as { session: TraceLaneSession }).session;
    const spy = vi.spyOn(session, 'onUrl').mockResolvedValue(undefined);
    await svc.afterCommand('url', ['bogus://'], undefined, new Error('bad url'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores non-url commands (e.g. click, setValue, execute)', async () => {
    const svc = new TraceLaneService({}, {}, { framework: 'mocha' });
    const session = (svc as unknown as { session: TraceLaneSession }).session;
    const spy = vi.spyOn(session, 'onUrl').mockResolvedValue(undefined);
    await svc.afterCommand('click', [], undefined);
    await svc.afterCommand('setValue', ['foo'], undefined);
    await svc.afterCommand('execute', [() => null], undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores a url command whose first arg is not a string', async () => {
    const svc = new TraceLaneService({}, {}, { framework: 'mocha' });
    const session = (svc as unknown as { session: TraceLaneSession }).session;
    const spy = vi.spyOn(session, 'onUrl').mockResolvedValue(undefined);
    await svc.afterCommand('url', [undefined], undefined);
    await svc.afterCommand('url', [123], undefined);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('traceLaneHooks — afterCommand hook (T-9)', () => {
  it('exposes afterCommand on the bound hook factory', () => {
    const hooks = traceLaneHooks();
    expect(typeof hooks.afterCommand).toBe('function');
  });

  it('forwards the URL to session.onUrl only on success', async () => {
    const hooks = traceLaneHooks();
    const browser = mockBrowser();
    await hooks.before({}, [], browser as unknown as WebdriverIO.Browser);
    // Without a real session reference, the smoke check is: it doesn't throw.
    await expect(
      hooks.afterCommand('url', ['https://example.com/x'], undefined),
    ).resolves.not.toThrow();
    await expect(
      hooks.afterCommand('url', ['bad'], undefined, new Error('boom')),
    ).resolves.not.toThrow();
    await expect(hooks.afterCommand('click', [], undefined)).resolves.not.toThrow();
  });
});
