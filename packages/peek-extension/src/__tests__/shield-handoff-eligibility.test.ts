// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveHandoffEligibility } from '../permissions/dispatcher';

beforeEach(() => {
  document.body.innerHTML = `
    <input id="text" type="text" aria-label="Salary">
    <input id="pw" type="password">
    <input id="otp" autocomplete="one-time-code">
    <textarea id="ta"></textarea>
    <button id="btn">Delete account</button>
    <div id="ce" contenteditable="true"></div>
    <fieldset>
      <legend>Delete account</legend>
      <input id="confirm" type="text" aria-label="Type DELETE to confirm">
    </fieldset>`;
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveHandoffEligibility', () => {
  it('text input → editable, not sensitive', () => {
    const r = resolveHandoffEligibility('#text');
    expect(r).toMatchObject({
      editable: true,
      tagName: 'INPUT',
      inputType: 'text',
      isConnected: true,
    });
    expect(r.destructiveSignals.ariaLabel).toBe('Salary');
  });
  it('textarea + contenteditable → editable', () => {
    expect(resolveHandoffEligibility('#ta').editable).toBe(true);
    expect(resolveHandoffEligibility('#ce').editable).toBe(true);
  });
  it('button → not editable', () => {
    expect(resolveHandoffEligibility('#btn').editable).toBe(false);
    expect(resolveHandoffEligibility('#btn').destructiveSignals.text).toBe('Delete account');
  });
  it('password / one-time-code flagged via inputType + autocomplete', () => {
    expect(resolveHandoffEligibility('#pw').inputType).toBe('password');
    expect(resolveHandoffEligibility('#otp').autocomplete).toBe('one-time-code');
  });
  it('editable field under a destructive section heading → nearbyHeading resolved', () => {
    // An editable input is eligible on its own signals, but an input nested in a
    // "Delete account" fieldset must surface that heading so the SW's
    // isDestructive matcher can refuse it (destructive coverage).
    const r = resolveHandoffEligibility('#confirm');
    expect(r.editable).toBe(true);
    expect(r.destructiveSignals.nearbyHeading).toContain('Delete account');
  });
  it('missing selector → editable:false, isConnected:false', () => {
    expect(resolveHandoffEligibility('#nope')).toMatchObject({
      editable: false,
      isConnected: false,
    });
  });
});
