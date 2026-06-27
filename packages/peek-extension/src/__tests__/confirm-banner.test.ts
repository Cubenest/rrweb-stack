import { describe, expect, it } from 'vitest';
import {
  ConfirmResolutionTracker,
  isShowConfirmFromBackground,
} from '../../entrypoints/sidepanel/confirm-flow';
import {
  type ConfirmChoice,
  closedVerdict,
  confirmLevelHeader,
  describeAction,
  nextVerdict,
} from '../../entrypoints/sidepanel/sections/ConfirmBanner';
import type { Action } from '../permissions/action-protocol';

const REQ = 'req-42';

describe('nextVerdict — pure reducer driving the confirm banner', () => {
  it('Allow → {verdict:allow, alwaysForSite:false}', () => {
    expect(nextVerdict(REQ, 'allow')).toEqual({
      type: 'confirmVerdict',
      requestId: REQ,
      verdict: 'allow',
      alwaysForSite: false,
    });
  });

  it('Always-for-site → {verdict:allow, alwaysForSite:true}', () => {
    expect(nextVerdict(REQ, 'always')).toEqual({
      type: 'confirmVerdict',
      requestId: REQ,
      verdict: 'allow',
      alwaysForSite: true,
    });
  });

  it('Deny → {verdict:deny}', () => {
    expect(nextVerdict(REQ, 'deny')).toEqual({
      type: 'confirmVerdict',
      requestId: REQ,
      verdict: 'deny',
      alwaysForSite: false,
    });
  });

  it('rejects an unknown choice by defaulting to deny (fail-closed)', () => {
    expect(nextVerdict(REQ, 'bogus' as ConfirmChoice).verdict).toBe('deny');
  });
});

describe('closedVerdict — unmount / panel-closed default', () => {
  it('defaults to deny (fail-closed) on panel closure, flagged closed (item F)', () => {
    expect(closedVerdict(REQ)).toEqual({
      type: 'confirmVerdict',
      requestId: REQ,
      verdict: 'deny',
      alwaysForSite: false,
      closed: true,
    });
  });
});

describe('describeAction — human banner copy', () => {
  it('describes a click with its selector', () => {
    const action: Action = { type: 'click', selector: '#buy', button: 'left' };
    expect(describeAction(action)).toMatch(/click/i);
    expect(describeAction(action)).toContain('#buy');
  });

  it('describes a type action WITHOUT leaking the typed text', () => {
    const action: Action = { type: 'type', selector: '#pw', text: 'hunter2', delay: 40 };
    const copy = describeAction(action);
    expect(copy).toMatch(/type/i);
    expect(copy).toContain('#pw');
    expect(copy).not.toContain('hunter2'); // never render the secret
  });

  it('describes a navigate with its URL', () => {
    const action: Action = { type: 'navigate', url: 'https://example.com/checkout' };
    expect(describeAction(action)).toContain('https://example.com/checkout');
  });

  it('describes a scroll', () => {
    expect(describeAction({ type: 'scroll', y: 500 })).toMatch(/scroll/i);
  });
});

// Item D(a): the side panel's showConfirm listener must only accept a prompt
// from the extension's OWN background SW — `sender.id === chrome.runtime.id`.
// A page/content-script context (which can be influenced by an AI) must NOT be
// able to inject a `showConfirm` and replace `pendingConfirm` with a forged
// action the user then approves.
describe('isShowConfirmFromBackground — sender + shape gate for showConfirm', () => {
  const EXT_ID = 'abcd';
  const SHOW = {
    type: 'showConfirm',
    requestId: 'req-1',
    action: { type: 'click', selector: '#x', button: 'left' },
    origin: 'https://example.com',
    level: 3,
  };

  it('accepts a well-formed showConfirm from the extension itself', () => {
    expect(isShowConfirmFromBackground(SHOW, { id: EXT_ID }, EXT_ID)).toBe(true);
  });

  it('rejects a showConfirm from a different sender id (a page / other extension)', () => {
    expect(isShowConfirmFromBackground(SHOW, { id: 'evil-extension' }, EXT_ID)).toBe(false);
    expect(isShowConfirmFromBackground(SHOW, { id: undefined }, EXT_ID)).toBe(false);
    expect(isShowConfirmFromBackground(SHOW, {}, EXT_ID)).toBe(false);
  });

  it('rejects a non-showConfirm message even from the right sender', () => {
    expect(isShowConfirmFromBackground({ type: 'somethingElse' }, { id: EXT_ID }, EXT_ID)).toBe(
      false,
    );
  });
});

describe('confirmLevelHeader — names the level that produced the prompt', () => {
  it('formats Level 3 as "Level 3 · Act-with-confirm"', () => {
    expect(confirmLevelHeader(3)).toBe('Level 3 · Act-with-confirm');
  });

  it('formats Level 4 as "Level 4 · YOLO this session"', () => {
    expect(confirmLevelHeader(4)).toBe('Level 4 · YOLO this session');
  });

  it('returns null for a null level (still loading)', () => {
    expect(confirmLevelHeader(null)).toBeNull();
  });
});

// Item D(b): RACE — resolveConfirm sets pendingConfirm to null, which triggers
// the [pendingConfirm] effect CLEANUP, which sends closedVerdict(requestId) for
// the SAME request AFTER the user's verdict. A synthetic deny must NOT follow /
// override an allow. The tracker records resolved ids so the cleanup skips them.
describe('ConfirmResolutionTracker — cleanup must not deny an already-resolved request', () => {
  it('an allow is NOT followed by a synthetic close-deny for the same requestId', () => {
    const tracker = new ConfirmResolutionTracker();
    // User clicks Allow → we send the verdict + mark the id resolved.
    tracker.markResolved('req-1');
    // The effect cleanup fires for req-1 (pendingConfirm went null). It must
    // recognize the id as already resolved and SKIP sending closedVerdict.
    expect(tracker.shouldSendCloseVerdict('req-1')).toBe(false);
  });

  it('a genuine panel close (no prior verdict) DOES send the close-deny', () => {
    const tracker = new ConfirmResolutionTracker();
    // No markResolved — the user closed the panel without choosing.
    expect(tracker.shouldSendCloseVerdict('req-2')).toBe(true);
  });

  it('is idempotent + per-request: resolving req-1 does not suppress req-2 close', () => {
    const tracker = new ConfirmResolutionTracker();
    tracker.markResolved('req-1');
    expect(tracker.shouldSendCloseVerdict('req-1')).toBe(false);
    expect(tracker.shouldSendCloseVerdict('req-2')).toBe(true);
  });
});
