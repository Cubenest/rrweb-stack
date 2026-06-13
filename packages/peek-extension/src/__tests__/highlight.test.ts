// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHighlight, clearHighlight } from '../permissions/highlight';

beforeEach(() => {
  document.body.innerHTML = `
    <h2>Account settings</h2>
    <button id="b" aria-label="Save">Save now</button>
    <input id="i">
  `;
});
afterEach(() => {
  clearHighlight();
  vi.restoreAllMocks();
});

describe('applyHighlight', () => {
  it('appends a fixed overlay div with the sentinel class + z-index + pointer-events:none', () => {
    const res = applyHighlight('#b');
    expect(res).toEqual({ ok: true });
    const overlay = document.body.querySelector('.__peek_highlight__') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.position).toBe('fixed');
    expect(overlay.style.zIndex).toBe('2147483647');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('with a label: renders a badge span carrying the label text', () => {
    applyHighlight('#b', 'Click this to save');
    const badge = document.body.querySelector('.__peek_highlight__ span');
    expect(badge?.textContent).toBe('Click this to save');
  });

  it('without a label: renders no badge span', () => {
    applyHighlight('#b');
    expect(document.body.querySelector('.__peek_highlight__ span')).toBeNull();
  });

  it('returns element-not-found for a selector that matches nothing', () => {
    expect(applyHighlight('#nope')).toEqual({ ok: false, error: 'element not found: #nope' });
  });

  it('returns invalid-selector for syntactically invalid CSS', () => {
    // 'a[' is an unclosed attribute selector — querySelector throws SyntaxError.
    expect(applyHighlight('a[')).toEqual({ ok: false, error: 'invalid selector: a[' });
  });

  it('called twice keeps exactly one overlay (replace, not stack) and detaches the old listeners', () => {
    applyHighlight('#b');
    const remove = vi.spyOn(window, 'removeEventListener');
    applyHighlight('#i');
    expect(document.body.querySelectorAll('.__peek_highlight__')).toHaveLength(1);
    // the first overlay's scroll+resize listeners must be torn down on replace
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

describe('clearHighlight', () => {
  it('removes the overlay div and its scroll/resize listeners', () => {
    applyHighlight('#b');
    const remove = vi.spyOn(window, 'removeEventListener');
    const res = clearHighlight();
    expect(res).toEqual({ ok: true });
    expect(document.body.querySelector('.__peek_highlight__')).toBeNull();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('is idempotent — returns ok with no overlay present', () => {
    expect(clearHighlight()).toEqual({ ok: true });
  });
});

// Mirrors dispatcher.test.ts: reconstruct the fn from .toString() in a scope
// with NO module-scope helpers, proving it survives executeScript serialization
// into the page's MAIN world without a ReferenceError.
describe('MAIN-world serialization (no module-scope helpers in the page)', () => {
  function reconstructInPageScope<T extends (...args: never[]) => unknown>(fn: T): T {
    return new Function(`return (${fn.toString()})`)() as T;
  }

  it('applyHighlight runs after serialization (no out-of-scope refs)', () => {
    const injected = reconstructInPageScope(applyHighlight);
    let res: unknown;
    expect(() => {
      res = injected('#b', 'label');
    }).not.toThrow();
    expect(res).toEqual({ ok: true });
    expect(document.body.querySelector('.__peek_highlight__')).not.toBeNull();
  });
});
