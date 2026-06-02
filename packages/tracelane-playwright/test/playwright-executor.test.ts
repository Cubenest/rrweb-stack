import { describe, expect, it, vi } from 'vitest';
import { createPlaywrightExecutor } from '../src/playwright-executor.js';

// The HIGH-RISK adapter seam (plan Task 5): @tracelane/core's BrowserExecutor
// `execute<T>(fn, ...args)` is VARIADIC, but Playwright's `page.evaluate(fn,
// arg)` takes ONE serializable arg. createPlaywrightExecutor packs {body, args}
// into that single arg and rebuilds+applies the fn in-page. These tests run the
// packed fn the way Playwright does (a single-arg call) to prove all positional
// args survive the round trip.

describe('PlaywrightExecutor.execute', () => {
  it('passes ALL positional args through to the in-page fn (variadic→single-arg pack)', async () => {
    // fake page.evaluate that actually runs the packed fn the way Playwright
    // does: it calls pageFunction(arg) with a single serializable arg.
    const page = {
      evaluate: vi.fn(async (pageFn: (a: unknown) => unknown, arg: unknown) => pageFn(arg)),
    };
    const ex = createPlaywrightExecutor(page as never);
    const fn = (a: number, b: string, c: { x: number }) => `${a}|${b}|${c.x}`;
    const out = await ex.execute(fn as never, 1, 'two', { x: 3 });
    expect(out).toBe('1|two|3');
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('works with zero args', async () => {
    const page = {
      evaluate: vi.fn(async (pageFn: (a: unknown) => unknown, arg: unknown) => pageFn(arg)),
    };
    const ex = createPlaywrightExecutor(page as never);
    const out = await ex.execute((() => 42) as never);
    expect(out).toBe(42);
  });

  it('cdp() throws when no CDP session is attached (Chromium-only)', async () => {
    const page = { evaluate: vi.fn() };
    const ex = createPlaywrightExecutor(page as never);
    await expect(ex.cdp('Network', 'enable')).rejects.toThrow(/CDP/i);
  });

  it('on() throws when no CDP session is attached (Chromium-only)', () => {
    const page = { evaluate: vi.fn() };
    const ex = createPlaywrightExecutor(page as never);
    expect(() => ex.on('Network.responseReceived', () => {})).toThrow(/CDP/i);
  });

  it('routes cdp(domain, command, params) to cdpSession.send("domain.command", params)', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const cdp = { send, on: vi.fn() };
    const page = { evaluate: vi.fn() };
    const ex = createPlaywrightExecutor(page as never, cdp as never);
    const res = await ex.cdp('Network', 'enable', { maxTotalBufferSize: 1 });
    expect(send).toHaveBeenCalledWith('Network.enable', { maxTotalBufferSize: 1 });
    expect(res).toEqual({ ok: true });
  });

  it('routes on(event, handler) to cdpSession.on(event, handler)', () => {
    const on = vi.fn();
    const cdp = { send: vi.fn(), on };
    const page = { evaluate: vi.fn() };
    const ex = createPlaywrightExecutor(page as never, cdp as never);
    const handler = () => {};
    ex.on('Network.responseReceived', handler);
    expect(on).toHaveBeenCalledWith('Network.responseReceived', handler);
  });
});
