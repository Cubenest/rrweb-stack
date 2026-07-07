import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConfirmVerdictMessage,
  ServiceWorkerUnavailableError,
  denyReason,
  isFromSidePanel,
  isNoReceiverError,
  isPairVerdict,
  isRecordingStateMessage,
  isShowConfirm,
  isShowPair,
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

// Item E: isShowConfirm must validate the FULL wire shape, not just
// `type === 'showConfirm'`. A malformed payload (missing/empty requestId, no
// action object) would otherwise crash the banner render or make the cleanup
// post a closedVerdict with an invalid requestId.
describe('isShowConfirm — full wire-shape validation', () => {
  const VALID = {
    type: 'showConfirm',
    requestId: 'req-1',
    action: { type: 'click', selector: '#x', button: 'left' },
    origin: 'https://example.com',
    level: 3,
  };

  it('accepts a well-formed showConfirm', () => {
    expect(isShowConfirm(VALID)).toBe(true);
  });

  it('accepts a destructive variant carrying destructiveTerm', () => {
    expect(isShowConfirm({ ...VALID, destructiveTerm: 'delete' })).toBe(true);
  });

  it('rejects a missing / non-integer / out-of-range level', () => {
    const { level: _omit, ...noLevel } = VALID;
    expect(isShowConfirm(noLevel)).toBe(false);
    expect(isShowConfirm({ ...VALID, level: 'three' })).toBe(false);
    expect(isShowConfirm({ ...VALID, level: 2.5 })).toBe(false);
    expect(isShowConfirm({ ...VALID, level: -1 })).toBe(false);
    expect(isShowConfirm({ ...VALID, level: 5 })).toBe(false);
  });

  it('rejects a non-string / empty requestId', () => {
    expect(isShowConfirm({ ...VALID, requestId: '' })).toBe(false);
    expect(isShowConfirm({ ...VALID, requestId: 123 })).toBe(false);
    const { requestId: _omit, ...noReq } = VALID;
    expect(isShowConfirm(noReq)).toBe(false);
  });

  it('rejects a missing / non-object action', () => {
    const { action: _omit, ...noAction } = VALID;
    expect(isShowConfirm(noAction)).toBe(false);
    expect(isShowConfirm({ ...VALID, action: null })).toBe(false);
    expect(isShowConfirm({ ...VALID, action: 'click' })).toBe(false);
    // An action object without a string `type` is not a valid Action.
    expect(isShowConfirm({ ...VALID, action: {} })).toBe(false);
  });

  it('rejects a non-string origin', () => {
    expect(isShowConfirm({ ...VALID, origin: 42 })).toBe(false);
  });

  it('rejects non-objects and the wrong message type', () => {
    expect(isShowConfirm(null)).toBe(false);
    expect(isShowConfirm('showConfirm')).toBe(false);
    expect(isShowConfirm({ type: 'confirmVerdict', requestId: 'x' })).toBe(false);
  });

  it('accepts a ShowConfirm with an optional client (SP3b)', () => {
    expect(isShowConfirm({ ...VALID, client: 'slack' })).toBe(true);
  });

  it('still accepts a ShowConfirm without client', () => {
    expect(isShowConfirm(VALID)).toBe(true);
  });
});

// Item F: a deny verdict must report WHY — a no-response timeout, an explicit
// user Deny click, or a panel close. Previously every non-timeout deny was
// mislabeled 'panel-closed', so an explicit Deny was indistinguishable from a
// closed panel in the audit log.
describe('denyReason — classifies a deny verdict for the audit log', () => {
  const TIMEOUT = 120_000;
  const denyVerdict = (closed?: boolean): ConfirmVerdictMessage => ({
    type: 'confirmVerdict',
    requestId: 'r',
    verdict: 'deny',
    ...(closed ? { closed: true } : {}),
  });

  it('a no-response timeout (elapsed >= timeout) → timeout', () => {
    expect(denyReason(denyVerdict(), TIMEOUT, TIMEOUT)).toBe('timeout');
    expect(denyReason(denyVerdict(), TIMEOUT + 5, TIMEOUT)).toBe('timeout');
  });

  it('an explicit user Deny (not closed, within the window) → user-deny', () => {
    expect(denyReason(denyVerdict(false), 800, TIMEOUT)).toBe('user-deny');
  });

  it('a panel close (closed flag set, within the window) → panel-closed', () => {
    expect(denyReason(denyVerdict(true), 800, TIMEOUT)).toBe('panel-closed');
  });

  it('a timeout takes precedence even if the closed flag is set', () => {
    // The SW's own timeout fired; that's the truth regardless of any flag.
    expect(denyReason(denyVerdict(true), TIMEOUT, TIMEOUT)).toBe('timeout');
  });
});

// SP4: isShowPair validates the full wire shape for the pairing trust-dial prompt.
describe('isShowPair — full wire-shape validation', () => {
  const VALID = {
    type: 'showPair',
    requestId: 'req-pair-1',
    clientName: 'Cursor MCP',
    code: 'A7F3',
  };

  it('accepts a well-formed showPair', () => {
    expect(isShowPair(VALID)).toBe(true);
  });

  it('rejects a non-string / empty requestId', () => {
    expect(isShowPair({ ...VALID, requestId: '' })).toBe(false);
    expect(isShowPair({ ...VALID, requestId: 123 })).toBe(false);
    const { requestId: _omit, ...noReq } = VALID;
    expect(isShowPair(noReq)).toBe(false);
  });

  it('rejects a non-string clientName', () => {
    expect(isShowPair({ ...VALID, clientName: 42 })).toBe(false);
    const { clientName: _omit, ...noClient } = VALID;
    expect(isShowPair(noClient)).toBe(false);
  });

  it('rejects a non-string code', () => {
    expect(isShowPair({ ...VALID, code: 9999 })).toBe(false);
    const { code: _omit, ...noCode } = VALID;
    expect(isShowPair(noCode)).toBe(false);
  });

  it('rejects non-objects and wrong message types', () => {
    expect(isShowPair(null)).toBe(false);
    expect(isShowPair('showPair')).toBe(false);
    expect(isShowPair({ type: 'showConfirm', requestId: 'x', clientName: 'y', code: 'z' })).toBe(
      false,
    );
  });
});

// SP4: isPairVerdict validates the pairing verdict shape.
describe('isPairVerdict — wire-shape validation', () => {
  const VALID_APPROVE: unknown = { type: 'pairVerdict', requestId: 'req-1', approved: true };
  const VALID_DENY: unknown = { type: 'pairVerdict', requestId: 'req-1', approved: false };

  it('accepts a well-formed approve verdict', () => {
    expect(isPairVerdict(VALID_APPROVE)).toBe(true);
  });

  it('accepts a well-formed deny verdict', () => {
    expect(isPairVerdict(VALID_DENY)).toBe(true);
  });

  it('rejects a non-string / empty requestId', () => {
    expect(isPairVerdict({ type: 'pairVerdict', requestId: '', approved: true })).toBe(false);
    expect(isPairVerdict({ type: 'pairVerdict', requestId: 123, approved: true })).toBe(false);
    expect(isPairVerdict({ type: 'pairVerdict', approved: true })).toBe(false);
  });

  it('rejects a non-boolean / missing approved', () => {
    expect(isPairVerdict({ type: 'pairVerdict', requestId: 'r', approved: 'yes' })).toBe(false);
    expect(isPairVerdict({ type: 'pairVerdict', requestId: 'r' })).toBe(false);
  });

  it('rejects non-objects and wrong message types', () => {
    expect(isPairVerdict(null)).toBe(false);
    expect(isPairVerdict('pairVerdict')).toBe(false);
    expect(isPairVerdict({ type: 'confirmVerdict', requestId: 'r', approved: true })).toBe(false);
  });
});

describe('isRecordingStateMessage', () => {
  it('accepts a well-formed recording.state message', () => {
    expect(isRecordingStateMessage({ type: 'recording.state', recording: true })).toBe(true);
    expect(isRecordingStateMessage({ type: 'recording.state', recording: false })).toBe(true);
  });

  it('rejects wrong type, missing/non-boolean recording, and non-objects', () => {
    expect(isRecordingStateMessage({ type: 'recording.state' })).toBe(false);
    expect(isRecordingStateMessage({ type: 'other', recording: true })).toBe(false);
    expect(isRecordingStateMessage({ type: 'recording.state', recording: 'yes' })).toBe(false);
    expect(isRecordingStateMessage(null)).toBe(false);
    expect(isRecordingStateMessage('recording.state')).toBe(false);
  });
});
