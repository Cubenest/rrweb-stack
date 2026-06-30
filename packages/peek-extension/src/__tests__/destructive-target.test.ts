// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { destructiveClickTarget } from '../shield/destructive-target';

beforeEach(() => {
  document.documentElement.innerHTML = '<body></body>';
});

describe('destructiveClickTarget', () => {
  it('matches a destructive button by its text', () => {
    document.body.innerHTML = '<button id="b">Delete account</button>';
    const hit = destructiveClickTarget(document.getElementById('b'));
    expect(hit?.term).toBe('delete');
    expect(hit?.el.id).toBe('b');
  });
  it('climbs from an inner element to the clickable ancestor', () => {
    document.body.innerHTML = '<button id="b"><span id="s">Remove</span></button>';
    expect(destructiveClickTarget(document.getElementById('s'))?.term).toBe('remove');
  });
  it('matches via aria-label and via an input[type=submit] value', () => {
    document.body.innerHTML =
      '<button id="b" aria-label="Pay now">$</button>' +
      '<input id="i" type="submit" value="Transfer funds">';
    expect(destructiveClickTarget(document.getElementById('b'))?.term).toBe('pay');
    expect(destructiveClickTarget(document.getElementById('i'))?.term).toBe('transfer');
  });
  it('matches via a nearby heading that precedes the control', () => {
    document.body.innerHTML =
      '<section><h2>Delete this repository</h2><button id="b">Continue</button></section>';
    expect(destructiveClickTarget(document.getElementById('b'))?.term).toBe('delete');
  });
  it('does NOT flag a benign control that precedes a later destructive heading', () => {
    // The "Delete" heading sits AFTER the button — it titles the next block, not this control,
    // so a position-precise nearby-heading lookup must not flag the benign "Continue" button.
    document.body.innerHTML =
      '<section><button id="b">Continue</button><h2>Delete this repository</h2></section>';
    expect(destructiveClickTarget(document.getElementById('b'))).toBeUndefined();
  });
  it('uses the nearest PRECEDING heading when several precede the control', () => {
    document.body.innerHTML =
      '<section><h2>Account settings</h2><h3>Delete account</h3><button id="b">Continue</button></section>';
    expect(destructiveClickTarget(document.getElementById('b'))?.term).toBe('delete');
  });
  it('returns undefined for benign controls and non-clickable / non-element targets', () => {
    document.body.innerHTML = '<button id="b">Save changes</button><div id="d">x</div>';
    expect(destructiveClickTarget(document.getElementById('b'))).toBeUndefined();
    expect(destructiveClickTarget(document.getElementById('d'))).toBeUndefined();
    expect(destructiveClickTarget(null)).toBeUndefined();
  });
});
