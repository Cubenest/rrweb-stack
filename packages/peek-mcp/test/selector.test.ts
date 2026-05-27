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
});
