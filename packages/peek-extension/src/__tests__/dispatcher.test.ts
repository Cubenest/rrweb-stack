// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { dispatchAction, resolveTarget } from '../permissions/dispatcher';

beforeEach(() => {
  document.body.innerHTML = `
    <h2>Account settings</h2>
    <button id="b" aria-label="Save">Save now</button>
    <input id="i">
    <a id="lnk" href="#">link</a>
    <button class="dup">first</button>
    <button class="dup">second</button>
    <div id="tall" style="height: 9999px">x</div>
  `;
});

describe('dispatchAction — click', () => {
  it('resolves the selector, clicks it, and returns ok', () => {
    let clicked = false;
    document.getElementById('b')?.addEventListener('click', () => {
      clicked = true;
    });
    expect(dispatchAction({ type: 'click', selector: '#b', button: 'left' })).toEqual({ ok: true });
    expect(clicked).toBe(true);
  });

  it('supports nth to disambiguate multiple matches', () => {
    const order: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.dup'))) {
      el.addEventListener('click', () => order.push(el.textContent ?? ''));
    }
    expect(dispatchAction({ type: 'click', selector: '.dup', nth: 1, button: 'left' })).toEqual({
      ok: true,
    });
    expect(order).toEqual(['second']);
  });

  it('returns ok:false for a missing selector', () => {
    expect(dispatchAction({ type: 'click', selector: '#nope', button: 'left' })).toEqual({
      ok: false,
      error: expect.stringMatching(/not found/i),
    });
  });
});

describe('dispatchAction — type', () => {
  it('sets value + fires input and change', () => {
    const events: string[] = [];
    const input = document.getElementById('i') as HTMLInputElement;
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    expect(dispatchAction({ type: 'type', selector: '#i', text: 'hi', delay: 0 })).toEqual({
      ok: true,
    });
    expect(input.value).toBe('hi');
    expect(events).toContain('input');
    expect(events).toContain('change');
  });

  it('returns ok:false typing into a non-existent element', () => {
    expect(dispatchAction({ type: 'type', selector: '#missing', text: 'x', delay: 0 })).toEqual({
      ok: false,
      error: expect.stringMatching(/not found/i),
    });
  });
});

describe('dispatchAction — navigate', () => {
  it('rejects a non-http(s) URL without navigating', () => {
    const res = dispatchAction({ type: 'navigate', url: 'javascript:alert(1)' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/url/i);
  });

  it('accepts an http(s) URL', () => {
    // jsdom doesn't actually navigate; we assert the dispatcher reports ok and
    // doesn't throw for a well-formed http(s) URL.
    const res = dispatchAction({ type: 'navigate', url: 'https://example.com/next' });
    expect(res.ok).toBe(true);
  });
});

describe('dispatchAction — scroll', () => {
  it('scrolls to absolute coordinates', () => {
    let target: { x: number; y: number } | null = null;
    window.scrollTo = ((x: number, y: number) => {
      target = { x, y };
    }) as typeof window.scrollTo;
    expect(dispatchAction({ type: 'scroll', x: 0, y: 500 })).toEqual({ ok: true });
    expect(target).toEqual({ x: 0, y: 500 });
  });

  it('scrolls a selected element into view', () => {
    const el = document.getElementById('tall') as HTMLElement;
    let called = false;
    el.scrollIntoView = (() => {
      called = true;
    }) as typeof el.scrollIntoView;
    expect(dispatchAction({ type: 'scroll', selector: '#tall' })).toEqual({ ok: true });
    expect(called).toBe(true);
  });

  it('returns ok:false scrolling to a missing selector', () => {
    const res = dispatchAction({ type: 'scroll', selector: '#gone' });
    expect(res.ok).toBe(false);
  });
});

describe('dispatchAction — unsupported action', () => {
  it('returns ok:false for an action type the MVP does not handle', () => {
    const res = dispatchAction({ type: 'screenshot' } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unsupported/i);
  });
});

describe('resolveTarget', () => {
  it('returns text + ariaLabel + nearbyHeading for the matched element', () => {
    expect(resolveTarget('#b')).toMatchObject({
      text: 'Save now',
      ariaLabel: 'Save',
      nearbyHeading: 'Account settings',
    });
  });

  it('returns an empty target for a missing selector (never throws)', () => {
    expect(resolveTarget('#nope')).toEqual({});
  });

  it('returns an empty target for an empty selector', () => {
    expect(resolveTarget('')).toEqual({});
  });
});
