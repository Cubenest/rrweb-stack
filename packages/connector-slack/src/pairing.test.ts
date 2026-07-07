import { describe, expect, it, vi } from 'vitest';
import { maybePair } from './pairing.js';

// Minimal ConnectorRuntime-shaped stub for pair() tests
interface FakeRuntime {
  pair: (displayCode: (code: string) => void) => Promise<boolean>;
}

describe('maybePair', () => {
  it('calls runtime.pair when isPaired is false', async () => {
    const pairFn = vi.fn().mockResolvedValue(true);
    const runtime: FakeRuntime = { pair: pairFn };
    const displayCode = vi.fn();

    await maybePair(runtime as never, false, displayCode);

    expect(pairFn).toHaveBeenCalledOnce();
  });

  it('passes the displayCode callback through to runtime.pair', async () => {
    let capturedDisplay: ((code: string) => void) | undefined;
    const runtime: FakeRuntime = {
      pair: vi.fn(async (displayCode) => {
        capturedDisplay = displayCode;
        return true;
      }),
    };
    const displayCode = vi.fn();

    await maybePair(runtime as never, false, displayCode);

    // The exact same displayCode function is forwarded
    expect(capturedDisplay).toBe(displayCode);
  });

  it('does NOT call runtime.pair when isPaired is true', async () => {
    const pairFn = vi.fn().mockResolvedValue(true);
    const runtime: FakeRuntime = { pair: pairFn };
    const displayCode = vi.fn();

    await maybePair(runtime as never, true, displayCode);

    expect(pairFn).not.toHaveBeenCalled();
  });

  it('invokes the displayCode with a 4-digit code when paired for the first time', async () => {
    // Simulate what runtime.pair does: it generates the code and calls displayCode.
    // maybePair's responsibility is to forward the displayCode to runtime.pair.
    const codesDisplayed: string[] = [];
    const runtime: FakeRuntime = {
      pair: async (displayCode) => {
        displayCode('1234');
        return true;
      },
    };

    await maybePair(runtime as never, false, (code) => {
      codesDisplayed.push(code);
    });

    expect(codesDisplayed).toEqual(['1234']);
  });
});
