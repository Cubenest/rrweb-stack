import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServiceWorkerUnavailableError,
  isFromSidePanel,
  isNoReceiverError,
  sendCmd,
} from '../messaging/protocol';

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

  it('round-trips activateRecorderForTab with the typed result shape', async () => {
    // activeTab grant path: side panel sends this after `requestActivation('tab')`
    // returns granted; SW responds with the inject result. The wire shape must
    // be {ok, reason?} (ActivateRecorderResult), not InjectResult{ok, tabId, error?}.
    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
      ok: true,
    } as unknown as undefined);
    const okResult = await sendCmd({ type: 'activateRecorderForTab', tabId: 42 });
    expect(okResult).toEqual({ ok: true });

    vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({
      ok: false,
      reason: 'No window with id: 42.',
    } as unknown as undefined);
    const errResult = await sendCmd({ type: 'activateRecorderForTab', tabId: 42 });
    expect(errResult.ok).toBe(false);
    expect(errResult.reason).toContain('No window');
  });
});

// Item C: a confirmVerdict must only be honored when it originates from the
// extension's OWN side panel — not from any other extension-origin context
// (an options page, a popup, a devtools panel, a content script the AI could
// influence). Correlating only by requestId let any such context approve a
// pending action (and silently escalate via alwaysForSite).
describe('isFromSidePanel', () => {
  const SIDEPANEL_URL = 'chrome-extension://abcd/sidepanel.html';

  it('accepts a sender whose url is exactly the sidepanel page', () => {
    expect(isFromSidePanel({ url: SIDEPANEL_URL }, SIDEPANEL_URL)).toBe(true);
  });

  it('accepts a sidepanel url carrying a query/hash suffix', () => {
    expect(isFromSidePanel({ url: `${SIDEPANEL_URL}?x=1#frag` }, SIDEPANEL_URL)).toBe(true);
  });

  it('rejects a different extension page (options/popup/devtools)', () => {
    expect(isFromSidePanel({ url: 'chrome-extension://abcd/options.html' }, SIDEPANEL_URL)).toBe(
      false,
    );
    expect(isFromSidePanel({ url: 'chrome-extension://abcd/popup.html' }, SIDEPANEL_URL)).toBe(
      false,
    );
  });

  it('rejects a sender with no url (e.g. a content script / SW)', () => {
    expect(isFromSidePanel({}, SIDEPANEL_URL)).toBe(false);
    expect(isFromSidePanel({ url: undefined }, SIDEPANEL_URL)).toBe(false);
  });

  it('rejects a look-alike prefix that is not a path boundary', () => {
    // A page named sidepanel.html.evil.html must not pass the prefix check.
    expect(
      isFromSidePanel({ url: 'chrome-extension://abcd/sidepanel.html.evil.html' }, SIDEPANEL_URL),
    ).toBe(false);
  });
});
