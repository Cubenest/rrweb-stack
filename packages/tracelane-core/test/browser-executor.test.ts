import { describe, expect, it, vi } from 'vitest';
import type { BrowserExecutor } from '../src/browser-executor';

// BrowserExecutor is a structural interface (ADR-0004): the wdio/playwright/
// cypress adapters implement it in their own packages, so the contract is
// verified structurally here with a mock implementation. There is no runtime
// value to import — these tests lock the call shape the recorder relies on.

function createMockExecutor(): BrowserExecutor {
  return {
    execute: vi.fn(async <T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> => {
      // Mimic browser.execute: run the serialized fn against args in-process.
      return fn(...args);
    }),
    executeAsync: vi.fn(
      async <T>(_fn: (...args: unknown[]) => void, ..._args: unknown[]): Promise<T> => {
        return undefined as T;
      },
    ),
    cdp: vi.fn(
      async (_domain: string, _command: string, _params?: Record<string, unknown>) => undefined,
    ),
    on: vi.fn((_event: string, _handler: (params: unknown) => void): void => {}),
  };
}

describe('BrowserExecutor contract', () => {
  it('a structural mock satisfies the interface', () => {
    const exec = createMockExecutor();
    expect(typeof exec.execute).toBe('function');
    expect(typeof exec.executeAsync).toBe('function');
    expect(typeof exec.cdp).toBe('function');
    expect(typeof exec.on).toBe('function');
  });

  it('execute<T> passes args explicitly and returns the typed result', async () => {
    const exec = createMockExecutor();
    const result = await exec.execute(
      (a: unknown, b: unknown) => (a as number) + (b as number),
      2,
      3,
    );
    expect(result).toBe(5);
  });

  it('cdp accepts (domain, command, params?) and is awaitable', async () => {
    const exec = createMockExecutor();
    await expect(exec.cdp('Network', 'enable')).resolves.toBeUndefined();
    await expect(
      exec.cdp('Network', 'setExtraHTTPHeaders', { headers: { traceparent: 'x' } }),
    ).resolves.toBeUndefined();
  });

  it('on registers an event handler', () => {
    const exec = createMockExecutor();
    const handler = vi.fn();
    exec.on('Network.responseReceived', handler);
    expect(exec.on).toHaveBeenCalledWith('Network.responseReceived', handler);
  });
});
