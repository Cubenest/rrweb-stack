import { describe, expect, it } from 'vitest';
import { indexNodes, isStableToken, localSelector, selectorFor } from '../src/mcp/selector.js';
import { documentWith, el, freshIds, text } from './fixtures/rrweb.js';

describe('isStableToken', () => {
  it('keeps word-y identifiers', () => {
    expect(isStableToken('submit-button')).toBe(true);
    expect(isStableToken('nav')).toBe(true);
    expect(isStableToken('primaryCta')).toBe(true);
  });

  it('rejects emotion / styled-components / css-module hashes', () => {
    expect(isStableToken('css-1q2w3e')).toBe(false);
    expect(isStableToken('sc-bdVaJa')).toBe(false);
    expect(isStableToken('Button_x8Hk2')).toBe(false);
    expect(isStableToken('Card__a1b2c3')).toBe(false);
  });

  it('rejects short generated emotion/styled suffixes too (M3 lowered thresholds)', () => {
    expect(isStableToken('css-abc')).toBe(false); // css-{3,}
    expect(isStableToken('sc-aBcd')).toBe(false); // sc-{4,}
  });

  it('rejects long content-hash-looking tokens and overlong tokens', () => {
    expect(isStableToken('a1b2c3d4e5f6')).toBe(false);
    expect(isStableToken('x'.repeat(50))).toBe(false);
    expect(isStableToken('')).toBe(false);
  });
});

describe('localSelector', () => {
  it('prefers a stable #id', () => {
    freshIds();
    expect(localSelector(el('button', { attributes: { id: 'submit' } }))).toBe('#submit');
  });

  it('prefers data-testid over class', () => {
    freshIds();
    expect(
      localSelector(el('button', { attributes: { 'data-testid': 'cta', class: 'btn primary' } })),
    ).toBe('[data-testid="cta"]');
  });

  it('uses name for form controls', () => {
    freshIds();
    expect(localSelector(el('input', { attributes: { name: 'email' } }))).toBe(
      'input[name="email"]',
    );
  });

  it('falls back to tag.class (first two stable classes)', () => {
    freshIds();
    expect(localSelector(el('div', { attributes: { class: 'card primary css-1q2w3e' } }))).toBe(
      'div.card.primary',
    );
  });

  it('falls back to bare tag when nothing stable', () => {
    freshIds();
    expect(localSelector(el('section', { attributes: { class: 'css-xyz123' } }))).toBe('section');
  });

  it('returns undefined for non-element nodes', () => {
    freshIds();
    expect(localSelector(text('hi'))).toBeUndefined();
  });
});

describe('selectorFor', () => {
  it('stops at the nearest id anchor', () => {
    freshIds();
    const button = el('button', { attributes: { id: 'go' } });
    const wrapper = el('div', { attributes: { class: 'wrap' }, children: [button] });
    const root = documentWith([wrapper]);
    const index = indexNodes(root);
    expect(selectorFor(index, button.id)).toBe('#go');
  });

  it('builds a > path of stable segments, stopping at body/html', () => {
    freshIds();
    const link = el('a', { attributes: { class: 'nav-link' } });
    const nav = el('nav', { attributes: { class: 'main-nav' }, children: [link] });
    const root = documentWith([nav]);
    const index = indexNodes(root);
    // body/html are unique structure anchors and are dropped from the path.
    expect(selectorFor(index, link.id)).toBe('nav.main-nav > a.nav-link');
  });

  it('adds :nth-of-type to disambiguate same-tag siblings', () => {
    freshIds();
    const li1 = el('li', { attributes: { class: 'item' } });
    const li2 = el('li', { attributes: { class: 'item' } });
    const ul = el('ul', { attributes: { id: 'list' }, children: [li1, li2] });
    const root = documentWith([ul]);
    const index = indexNodes(root);
    expect(selectorFor(index, li2.id)).toBe('#list > li.item:nth-of-type(2)');
  });

  it('returns undefined for an unknown id', () => {
    freshIds();
    const root = documentWith([el('div')]);
    const index = indexNodes(root);
    expect(selectorFor(index, 9999)).toBeUndefined();
  });

  // [aria-label]/[placeholder] are readable but NOT guaranteed unique, so
  // selectorFor must keep climbing past them (ancestor + nth-of-type) instead
  // of emitting a bare, ambiguous attribute selector that strict-mode-fails.
  it('keeps climbing past a non-unique placeholder, disambiguating siblings', () => {
    freshIds();
    const i1 = el('input', { attributes: { placeholder: 'Search' } });
    const i2 = el('input', { attributes: { placeholder: 'Search' } });
    const wrapper = el('div', { attributes: { id: 'box' }, children: [i1, i2] });
    const root = documentWith([wrapper]);
    const index = indexNodes(root);
    const sel = selectorFor(index, i2.id);
    // Must NOT be the bare ambiguous selector.
    expect(sel).not.toBe('input[placeholder="Search"]');
    // Must disambiguate: ancestor context + nth-of-type.
    expect(sel).toBe('#box > input[placeholder="Search"]:nth-of-type(2)');
  });

  it('keeps climbing past aria-label when it has same-tag siblings', () => {
    freshIds();
    const b1 = el('button', { attributes: { 'aria-label': 'Menu' } });
    const b2 = el('button', { attributes: { 'aria-label': 'Menu' } });
    const wrapper = el('div', { attributes: { id: 'bar' }, children: [b1, b2] });
    const root = documentWith([wrapper]);
    const index = indexNodes(root);
    const sel = selectorFor(index, b2.id);
    expect(sel).not.toBe('[aria-label="Menu"]');
    // localSelector emits a bare `[aria-label="…"]` (no tag prefix); the climb
    // adds the ancestor + nth-of-type that disambiguates the two siblings.
    expect(sel).toBe('#bar > [aria-label="Menu"]:nth-of-type(2)');
  });

  it('still terminates the climb at #id, [data-testid], and tag[name] anchors', () => {
    freshIds();
    // #id anchor — no parent prefix.
    const idNode = el('button', { attributes: { id: 'go' } });
    const idWrap = el('div', { attributes: { class: 'wrap' }, children: [idNode] });
    // [data-testid] anchor — no parent prefix.
    const testNode = el('button', { attributes: { 'data-testid': 'cta' } });
    const testWrap = el('div', { attributes: { class: 'wrap' }, children: [testNode] });
    // tag[name] anchor — no parent prefix, no nth-of-type even with a sibling.
    const named = el('input', { attributes: { name: 'email' } });
    const namedSibling = el('input', { attributes: { name: 'pass' } });
    const namedWrap = el('div', {
      attributes: { class: 'form' },
      children: [named, namedSibling],
    });
    const root = documentWith([idWrap, testWrap, namedWrap]);
    const index = indexNodes(root);
    expect(selectorFor(index, idNode.id)).toBe('#go');
    expect(selectorFor(index, testNode.id)).toBe('[data-testid="cta"]');
    expect(selectorFor(index, named.id)).toBe('input[name="email"]');
  });

  // Untrusted recordings can carry adversarial attribute values. A `name` value
  // that literally contains `[aria-label=` must NOT be mistaken for a soft
  // aria-label segment — the soft check keys off the first attribute NAME, not a
  // substring of the rendered selector, so this still anchors as tag[name].
  it('does not mis-classify a name value that contains "[aria-label="', () => {
    freshIds();
    const tricky = el('input', { attributes: { name: 'x[aria-label=y' } });
    const sibling = el('input', { attributes: { name: 'z' } });
    const wrapper = el('div', { attributes: { class: 'form' }, children: [tricky, sibling] });
    const root = documentWith([wrapper]);
    const index = indexNodes(root);
    // Anchors as a bare tag[name] selector — no parent prefix, no nth-of-type.
    expect(selectorFor(index, tricky.id)).toBe('input[name="x[aria-label=y"]');
  });
});

describe('localSelector — aria-label / placeholder hooks', () => {
  it('uses [aria-label] when no id/test-id/name', () => {
    expect(localSelector(el('button', { attributes: { 'aria-label': 'Close' } }))).toBe(
      '[aria-label="Close"]',
    );
  });
  it('uses tag[placeholder] for inputs when no id/test-id/name', () => {
    expect(localSelector(el('input', { attributes: { placeholder: 'Email' } }))).toBe(
      'input[placeholder="Email"]',
    );
  });
  it('id still wins over aria-label', () => {
    expect(localSelector(el('button', { attributes: { id: 'x', 'aria-label': 'Close' } }))).toBe(
      '#x',
    );
  });
});
