import { describe, expect, it } from 'vitest';
import {
  accessibleName,
  implicitRole,
  playwrightLocator,
  visibleText,
} from '../src/mcp/playwright-locator.js';
import { indexNodes } from '../src/mcp/selector.js';
import { documentWith, el, freshIds, text } from './fixtures/rrweb.js';

const idx = (root: ReturnType<typeof documentWith>) => indexNodes(root);

describe('implicitRole', () => {
  it('maps tags/types to ARIA roles', () => {
    freshIds();
    expect(implicitRole(el('button'))).toBe('button');
    expect(implicitRole(el('a', { attributes: { href: '/x' } }))).toBe('link');
    expect(implicitRole(el('a'))).toBeUndefined();
    expect(implicitRole(el('select'))).toBe('combobox');
    expect(implicitRole(el('textarea'))).toBe('textbox');
    expect(implicitRole(el('input', { attributes: { type: 'checkbox' } }))).toBe('checkbox');
    expect(implicitRole(el('input', { attributes: { type: 'radio' } }))).toBe('radio');
    expect(implicitRole(el('input', { attributes: { type: 'submit' } }))).toBe('button');
    expect(implicitRole(el('input'))).toBe('textbox');
    expect(implicitRole(el('input', { attributes: { type: 'hidden' } }))).toBeUndefined();
    expect(implicitRole(el('div', { attributes: { role: 'tab' } }))).toBe('tab');
  });
});

describe('visibleText / accessibleName', () => {
  it('gathers descendant text, skipping script/style', () => {
    freshIds();
    const b = el('button', {
      children: [text('Save '), el('span', { children: [text('changes')] })],
    });
    expect(visibleText(b)).toBe('Save changes');
    const withStyle = el('button', {
      children: [el('style', { children: [text('x{}')] }), text('Go')],
    });
    expect(visibleText(withStyle)).toBe('Go');
  });
  it('accessibleName prefers aria-label, else own text for button/link', () => {
    freshIds();
    expect(
      accessibleName(
        el('button', { attributes: { 'aria-label': 'Close' }, children: [text('X')] }),
      ),
    ).toBe('Close');
    expect(accessibleName(el('button', { children: [text('Sign in')] }))).toBe('Sign in');
    expect(accessibleName(el('input', { attributes: { type: 'text' } }))).toBeUndefined();
  });
});

describe('playwrightLocator', () => {
  it('prefers getByTestId', () => {
    freshIds();
    const b = el('button', { attributes: { 'data-testid': 'submit', id: 'x' } });
    expect(playwrightLocator(idx(documentWith([b])), b.id)).toBe("page.getByTestId('submit')");
  });
  it('uses getByRole with accessible name', () => {
    freshIds();
    const b = el('button', { children: [text('Sign in')] });
    expect(playwrightLocator(idx(documentWith([b])), b.id)).toBe(
      "page.getByRole('button', { name: 'Sign in' })",
    );
  });
  it('uses getByPlaceholder for inputs', () => {
    freshIds();
    const i = el('input', { attributes: { placeholder: 'Email' } });
    expect(playwrightLocator(idx(documentWith([i])), i.id)).toBe("page.getByPlaceholder('Email')");
  });
  it('falls back to CSS page.locator when ambiguous', () => {
    freshIds();
    const a = el('button', { children: [text('Go')] });
    const b = el('button', { children: [text('Go')] });
    expect(playwrightLocator(idx(documentWith([a, b])), a.id)).toMatch(/^page\.locator\('/);
  });
  it('returns undefined when even CSS cannot resolve (node absent)', () => {
    freshIds();
    expect(playwrightLocator(idx(documentWith([el('div')])), 999999)).toBeUndefined();
  });
});
