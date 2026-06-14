import { describe, expect, it } from 'vitest';
import { describeAction } from '../shield/describe-action';

describe('describeAction', () => {
  it('click uses target text, clipped to 60 chars', () => {
    expect(
      describeAction({ type: 'click', selector: '#x', button: 'left' }, { text: 'Easy Apply' }),
    ).toBe("Clicking 'Easy Apply'");
    const long = 'A'.repeat(80);
    expect(describeAction({ type: 'click', selector: '#x', button: 'left' }, { text: long })).toBe(
      `Clicking '${'A'.repeat(59)}…'`,
    );
  });
  it('click falls back to ariaLabel then selector', () => {
    expect(
      describeAction({ type: 'click', selector: '#x', button: 'left' }, { ariaLabel: 'Save' }),
    ).toBe("Clicking 'Save'");
    expect(describeAction({ type: 'click', selector: '#submit', button: 'left' }, {})).toBe(
      "Clicking '#submit'",
    );
  });
  it('type NEVER includes the typed text', () => {
    const label = describeAction(
      { type: 'type', selector: '#email', text: 'secret@x.com', delay: 0 },
      { ariaLabel: 'Email' },
    );
    expect(label).toBe('Typing into Email');
    expect(label).not.toContain('secret');
  });
  it('navigate is host-only (no path/query)', () => {
    expect(describeAction({ type: 'navigate', url: 'https://acme.test/jobs?token=abc' }, {})).toBe(
      'Navigating to acme.test',
    );
  });
  it('fixed phrases for scroll/back/forward/reload', () => {
    expect(describeAction({ type: 'reload' }, {})).toBe('Reloading the page');
  });
  it('returns the standing-by default for null action', () => {
    expect(describeAction(null, {})).toBe('peek is controlling this page — standing by');
  });
});
