import { describe, expect, it } from 'vitest';
import {
  type ConfirmChoice,
  closedVerdict,
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
  it('defaults to deny (fail-closed) on panel closure', () => {
    expect(closedVerdict(REQ)).toEqual({
      type: 'confirmVerdict',
      requestId: REQ,
      verdict: 'deny',
      alwaysForSite: false,
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
