import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceWorkerUnavailableError, isNoReceiverError, sendCmd } from '../messaging/protocol';

// Carry-in [10]: sendCmd must turn the MV3 "SW asleep / no receiver" rejection
// into a typed error callers can catch, not an opaque unhandled rejection.

describe('isNoReceiverError', () => {
  it('matches the Chrome phrasings for an absent receiver', () => {
    expect(
      isNoReceiverError(new Error('Could not establish connection. Receiving end does not exist.')),
    ).toBe(true);
    expect(
      isNoReceiverError(new Error('The message port closed before a response was received.')),
    ).toBe(true);
  });

  it('does not match a genuine handler error', () => {
    expect(isNoReceiverError(new Error('TypeError: cannot read x'))).toBe(false);
    expect(isNoReceiverError('some string')).toBe(false);
  });
});

describe('sendCmd', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the SW response on success', async () => {
    // fake-browser types sendMessage's return as void; the real API returns a
    // Promise of the response. Route the mock through unknown to satisfy both.
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
      state: 'connected',
    } as unknown as undefined);
    const res = await sendCmd({ type: 'getNativeHostState' });
    expect(res).toEqual({ state: 'connected' });
  });

  it('throws ServiceWorkerUnavailableError when the SW is unreachable', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );
    await expect(sendCmd({ type: 'getNativeHostState' })).rejects.toBeInstanceOf(
      ServiceWorkerUnavailableError,
    );
  });

  it('propagates a genuine handler error unchanged', async () => {
    const boom = new Error('handler exploded');
    vi.spyOn(chrome.runtime, 'sendMessage').mockRejectedValue(boom);
    await expect(sendCmd({ type: 'getNativeHostState' })).rejects.toBe(boom);
  });
});
