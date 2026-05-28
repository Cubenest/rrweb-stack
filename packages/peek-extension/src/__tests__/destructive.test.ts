import { describe, expect, it } from 'vitest';
import {
  BASE_DESTRUCTIVE_TERMS,
  effectiveDestructiveTerms,
  isDestructive,
  matchDestructive,
} from '../permissions/destructive';

describe('BASE_DESTRUCTIVE_TERMS', () => {
  it('contains every ADR-0010 / P2 PRD §E.3 term', () => {
    // Source: ADR-0010 (and P2 PRD §E.3 example). Failing this means a term was
    // accidentally dropped — review the diff carefully.
    const required = [
      'delete',
      'remove',
      'transfer',
      'send',
      'pay',
      'purchase',
      'buy',
      'confirm',
      'subscribe',
      'logout',
      'sign out',
      'unsubscribe',
      'cancel subscription',
      'wire',
      'withdraw',
    ];
    for (const term of required) {
      expect(BASE_DESTRUCTIVE_TERMS).toContain(term);
    }
  });

  it('is all-lowercase, trimmed (so the matcher can compare case-insensitively)', () => {
    for (const term of BASE_DESTRUCTIVE_TERMS) {
      expect(term).toBe(term.toLowerCase());
      expect(term.trim()).toBe(term);
      expect(term.length).toBeGreaterThan(0);
    }
  });
});

describe('matchDestructive (ADR-0010 substring matcher)', () => {
  // Each base term must trigger on its own button text — exhaustive guard.
  for (const term of BASE_DESTRUCTIVE_TERMS) {
    it(`triggers on the term "${term}" appearing in button text`, () => {
      // Capitalize first letter so the case-insensitivity is also exercised.
      const text = term.charAt(0).toUpperCase() + term.slice(1);
      const result = matchDestructive({ text });
      expect(result.matched).toBe(true);
      expect(result.term).toBe(term);
      expect(result.field).toBe('text');
    });
  }

  it('is case-insensitive (UPPER, lower, MiXeD)', () => {
    expect(matchDestructive({ text: 'DELETE ACCOUNT' }).matched).toBe(true);
    expect(matchDestructive({ text: 'delete account' }).matched).toBe(true);
    expect(matchDestructive({ text: 'DeLeTe AcCoUnT' }).matched).toBe(true);
  });

  it('matches partial / substring occurrences', () => {
    // "Yes, delete!" — destructive even with surrounding tokens.
    expect(matchDestructive({ text: 'Yes, delete!' }).matched).toBe(true);
    // "✕ Delete row" — leading non-word characters don't block detection.
    expect(matchDestructive({ text: '✕ Delete row' }).matched).toBe(true);
  });

  it('matches multi-word terms ("cancel subscription", "sign out")', () => {
    expect(matchDestructive({ text: 'Cancel Subscription' }).term).toBe('cancel subscription');
    expect(matchDestructive({ text: 'Sign out of all devices' }).term).toBe('sign out');
  });

  it('matches against ariaLabel when text is innocuous', () => {
    const result = matchDestructive({
      text: 'OK',
      ariaLabel: 'Confirm purchase',
    });
    expect(result.matched).toBe(true);
    expect(result.field).toBe('ariaLabel');
  });

  it('matches against the nearby heading when text + aria are innocuous', () => {
    const result = matchDestructive({
      text: 'Yes',
      ariaLabel: 'Submit',
      nearbyHeading: 'Delete account?',
    });
    expect(result.matched).toBe(true);
    expect(result.field).toBe('nearbyHeading');
  });

  it('returns no match for safe labels', () => {
    expect(matchDestructive({ text: 'Save draft' }).matched).toBe(false);
    expect(matchDestructive({ text: 'Add to cart' }).matched).toBe(false);
    expect(matchDestructive({ text: 'View details' }).matched).toBe(false);
  });

  it('handles missing / null candidate fields without throwing', () => {
    expect(matchDestructive({}).matched).toBe(false);
    expect(matchDestructive({ text: null, ariaLabel: null, nearbyHeading: null }).matched).toBe(
      false,
    );
  });

  it('an empty-string term in the list is ignored (defense in depth)', () => {
    // Otherwise an empty term would match EVERYTHING and the override fires
    // unconditionally — that would functionally disable Level 4 entirely.
    expect(matchDestructive({ text: 'Hello' }, [''])).toMatchObject({ matched: false });
  });
});

describe('effectiveDestructiveTerms (~/.peek/policy.json deltas)', () => {
  it('returns the base list when no policy is given', () => {
    const out = effectiveDestructiveTerms();
    for (const t of BASE_DESTRUCTIVE_TERMS) expect(out).toContain(t);
    expect(out).toHaveLength(BASE_DESTRUCTIVE_TERMS.length);
  });

  it('add { yeet, nuke } extends the matcher', () => {
    const out = effectiveDestructiveTerms({ add: ['yeet', 'nuke'] });
    expect(out).toContain('yeet');
    expect(out).toContain('nuke');
    // And the matcher actually uses them:
    expect(matchDestructive({ text: 'Yeet it' }, out).matched).toBe(true);
    expect(matchDestructive({ text: 'NUKE the data' }, out).term).toBe('nuke');
  });

  it('remove { confirm } drops the term (matcher no longer fires on it)', () => {
    const out = effectiveDestructiveTerms({ remove: ['confirm'] });
    expect(out).not.toContain('confirm');
    expect(matchDestructive({ text: 'Confirm' }, out).matched).toBe(false);
  });

  it('normalises user terms: trim + lowercase + drop empty/non-string', () => {
    const out = effectiveDestructiveTerms({
      add: ['  YeeT  ', '', '   ', 42 as unknown as string, undefined as unknown as string],
    });
    expect(out).toContain('yeet');
    // Nothing nasty made it in.
    expect(out.every((t) => t.trim() === t && t.toLowerCase() === t && t.length > 0)).toBe(true);
  });

  it('add wins ties with the base list (no-op de-dup)', () => {
    const before = effectiveDestructiveTerms().length;
    const after = effectiveDestructiveTerms({ add: ['delete', 'DELETE', 'delete'] }).length;
    expect(after).toBe(before);
  });

  it('remove of an unknown term is a silent no-op', () => {
    const out = effectiveDestructiveTerms({ remove: ['nothing-like-this'] });
    expect(out).toHaveLength(BASE_DESTRUCTIVE_TERMS.length);
  });
});

describe('isDestructive convenience (matcher + effective list)', () => {
  it('threads the user policy through', () => {
    expect(isDestructive({ text: 'Yeet' }, { add: ['yeet'] }).matched).toBe(true);
    expect(isDestructive({ text: 'Confirm' }, { remove: ['confirm'] }).matched).toBe(false);
  });
});
