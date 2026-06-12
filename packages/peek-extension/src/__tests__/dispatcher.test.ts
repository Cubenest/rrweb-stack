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

// --- SERIALIZATION boundary (the executeScript({ world:'MAIN', func }) path) ---
//
// dispatchAction / resolveTarget are passed by reference to
// chrome.scripting.executeScript({ world:'MAIN', func }). Chrome serializes ONLY
// the function's own `.toString()` source into the page — module-scope helpers
// (resolveElement) do NOT travel. The tests above call the functions directly in
// jsdom where resolveElement IS in module scope, so they can't catch a missing
// dependency. These reconstruct each function from its source in a scope WITHOUT
// resolveElement (exactly what the page's MAIN world sees) and assert it neither
// throws a ReferenceError nor silently no-ops. `new Function` closes over only
// globals (document/window/URL/Event/…), not this module — mirroring the page.
describe('MAIN-world serialization (no module-scope helpers in the page)', () => {
  /** Rebuild a fn from its source in a scope with NO module-scope helpers. */
  function reconstructInPageScope<T extends (...args: never[]) => unknown>(fn: T): T {
    // Reconstruct from `.toString()` in a fresh scope (no module-scope helpers),
    // emulating what executeScript serializes into the page's MAIN world.
    return new Function(`return (${fn.toString()})`)() as T;
  }

  it('dispatchAction({type:"type"}) actually sets .value after serialization', () => {
    const injected = reconstructInPageScope(dispatchAction);
    const input = document.getElementById('i') as HTMLInputElement;
    let res: unknown;
    expect(() => {
      res = injected({ type: 'type', selector: '#i', text: 'hi', delay: 0 });
    }).not.toThrow();
    expect(res).toEqual({ ok: true });
    expect(input.value).toBe('hi');
  });

  it('dispatchAction({type:"click"}) actually clicks after serialization', () => {
    const injected = reconstructInPageScope(dispatchAction);
    let clicked = false;
    document.getElementById('b')?.addEventListener('click', () => {
      clicked = true;
    });
    let res: unknown;
    expect(() => {
      res = injected({ type: 'click', selector: '#b', button: 'left' });
    }).not.toThrow();
    expect(res).toEqual({ ok: true });
    expect(clicked).toBe(true);
  });

  it('dispatchAction({type:"scroll", selector}) scrolls into view after serialization', () => {
    const injected = reconstructInPageScope(dispatchAction);
    const el = document.getElementById('tall') as HTMLElement;
    let called = false;
    el.scrollIntoView = (() => {
      called = true;
    }) as typeof el.scrollIntoView;
    let res: unknown;
    expect(() => {
      res = injected({ type: 'scroll', selector: '#tall' });
    }).not.toThrow();
    expect(res).toEqual({ ok: true });
    expect(called).toBe(true);
  });

  it('resolveTarget resolves matcher signals after serialization', () => {
    const injected = reconstructInPageScope(resolveTarget);
    let res: unknown;
    expect(() => {
      res = injected('#b');
    }).not.toThrow();
    expect(res).toMatchObject({
      text: 'Save now',
      ariaLabel: 'Save',
      nearbyHeading: 'Account settings',
    });
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

  it('item B (nth): resolves the SAME nth element the click will hit (not the first match)', () => {
    // A destructive element hiding behind a non-destructive first match. The
    // action is `click .nthrow [nth=1]`, which the dispatcher resolves to the
    // SECOND element. The destructive matcher must classify THAT element — not
    // the benign first match — or it would skip confirm on a destructive click.
    document.body.innerHTML = `
      <button class="nthrow">Save changes</button>
      <button class="nthrow">Delete account</button>
    `;
    // nth=0 (or omitted) → the benign first match.
    expect(resolveTarget('.nthrow')).toMatchObject({ text: 'Save changes' });
    expect(resolveTarget('.nthrow', 0)).toMatchObject({ text: 'Save changes' });
    // nth=1 → the destructive second match (the one the click hits).
    expect(resolveTarget('.nthrow', 1)).toMatchObject({ text: 'Delete account' });
  });

  it('item B (nth): an out-of-range nth resolves to an empty target (never throws)', () => {
    document.body.innerHTML = '<button class="only">One</button>';
    expect(resolveTarget('.only', 5)).toEqual({});
  });
});
